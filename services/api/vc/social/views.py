from django.db import transaction
from django.db.models import Prefetch
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.assets.models import MediaAsset
from vc.audit import service as audit
from vc.catalog.models import VendorProduct
from vc.core.exceptions import DomainError
from vc.core.geo import make_point
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsVendor
from vc.core.throttles import ReportSubmitThrottle
from vc.moderation.models import Report
from vc.notifications import service as notifications
from vc.vendors.handles import normalize_handle
from vc.vendors.models import Vendor
from vc.vendors.views import my_vendor

from . import services
from .models import Follow, Post, PostMedia, Review
from .serializers import (
    FollowedVendorSerializer,
    FollowStateSerializer,
    MyReviewSerializer,
    PostCreateSerializer,
    PostSerializer,
    PostUpdateSerializer,
    ReportPostSerializer,
    ReportReviewSerializer,
    ReviewReplySerializer,
    ReviewSerializer,
)

try:
    from django.contrib.gis.db.models.functions import Distance as GeoDistance
except ImportError:  # pragma: no cover — GeoDjango is always installed in this project
    GeoDistance = None


def _post_qs():
    return Post.objects.select_related("vendor").prefetch_related(
        Prefetch("media", queryset=PostMedia.objects.select_related("asset").order_by("position")),
        "linked_listings",
    )


def _post_with_relations(post_id):
    return _post_qs().get(id=post_id)


def _active_vendor_by_handle(handle: str) -> Vendor:
    return get_object_or_404(
        Vendor.objects.filter(status=Vendor.STATUS_ACTIVE), handle__iexact=normalize_handle(handle)
    )


# --- Follow ------------------------------------------------------------------------------------


class FollowView(APIView):
    """POST /vendors/{handle}/follow — idempotent: following an already-followed vendor just
    returns the current state (200), same shape as chat's get-or-create-a-chat pattern. Concurrency
    safety comes from `uniq_follow` (DB constraint) + `get_or_create`'s own atomic retry-on-conflict,
    not from any lock taken here (master prompt §5: "safe concurrent follow requests")."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: FollowStateSerializer, 201: FollowStateSerializer})
    def post(self, request, handle):
        vendor = _active_vendor_by_handle(handle)
        if vendor.owner_id == request.user.id:
            raise DomainError("You can't follow your own shop.", code="cannot_follow_own_shop")
        _, created = Follow.objects.get_or_create(user=request.user, vendor=vendor)
        if created:
            services.adjust_follower_count(vendor.id, 1)
            services.notify_new_follower(vendor.owner, request.user.name)
            audit.record("vendor.followed", request=request, target=vendor, role="customer")
        vendor.refresh_from_db(fields=["follower_count"])
        body = {"following": True, "follower_count": vendor.follower_count}
        return Response(
            FollowStateSerializer(body).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )


class UnfollowView(APIView):
    """POST /vendors/{handle}/unfollow — idempotent (200 whether or not you were following)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: FollowStateSerializer})
    def post(self, request, handle):
        vendor = get_object_or_404(Vendor, handle__iexact=normalize_handle(handle))
        deleted, _ = Follow.objects.filter(user=request.user, vendor=vendor).delete()
        if deleted:
            services.adjust_follower_count(vendor.id, -1)
            audit.record("vendor.unfollowed", request=request, target=vendor, role="customer")
        vendor.refresh_from_db(fields=["follower_count"])
        return Response(FollowStateSerializer({"following": False, "follower_count": vendor.follower_count}).data)


class FollowingListView(APIView):
    """GET /following — the customer's own Following list (master prompt §7), with optional
    `lat`/`lng` for a distance column, same opt-in shape as `/vendors`."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("lat", float, required=False),
            OpenApiParameter("lng", float, required=False),
        ],
        responses=FollowedVendorSerializer(many=True),
    )
    def get(self, request):
        qs = (
            Vendor.objects.filter(followers__user=request.user, status=Vendor.STATUS_ACTIVE)
            .select_related("location", "delivery", "profile")
            .prefetch_related("categories")
        )
        lat, lng = request.query_params.get("lat"), request.query_params.get("lng")
        if lat is not None and lng is not None:
            point = make_point(float(lat), float(lng))
            qs = qs.annotate(distance=GeoDistance("location__point", point)).order_by("distance")
        else:
            qs = qs.order_by("-followers__created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        # Every vendor on this page is, by definition of the query above, one `request.user`
        # follows — so `is_following` is always true here. Passing that as the precomputed
        # `following_ids` set (rather than `context={"request": request}`) keeps this consistent
        # with the N+1-avoidance pattern the rest of the app uses (master prompt §46) instead of
        # falling through to a per-row existence query.
        following_ids = {v.id for v in page}
        data = FollowedVendorSerializer(page, many=True, context={"following_ids": following_ids}).data
        return paginator.get_paginated_response(data)


# --- Feed --------------------------------------------------------------------------------------


class FeedView(APIView):
    """GET /feed — "From Shops You Follow" (master prompt §8/§30): real posts from vendors the
    customer follows, newest first. Empty (not an error) for a customer who follows no one yet."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=PostSerializer(many=True))
    def get(self, request):
        followed_ids = Follow.objects.filter(user=request.user).values_list("vendor_id", flat=True)
        qs = (
            _post_qs()
            .filter(vendor_id__in=followed_ids, status=Post.STATUS_PUBLISHED, vendor__status=Vendor.STATUS_ACTIVE)
            .order_by("-created_at")
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(PostSerializer(page, many=True).data)


# --- Posts (vendor-owned) -----------------------------------------------------------------------


class MyPostCollectionView(APIView):
    """GET lists every post this vendor has ever made (any status, including admin-hidden/removed
    — a vendor should see moderation outcomes on their own content, not have it vanish silently).
    POST publishes a new one from already-uploaded media (see `vc.assets`)."""

    permission_classes = [IsVendor]

    @extend_schema(responses=PostSerializer(many=True))
    def get(self, request):
        vendor = my_vendor(request.user)
        qs = _post_qs().filter(vendor=vendor).order_by("-created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(PostSerializer(page, many=True).data)

    @extend_schema(request=PostCreateSerializer, responses={201: PostSerializer})
    def post(self, request):
        vendor = my_vendor(request.user)
        s = PostCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data

        # Ownership check on every referenced id — never trust ids the frontend supplied (master
        # prompt §13/§45): media must be this user's own successful uploads, listings must be this
        # vendor's own active catalog entries.
        assets_by_id = {
            a.id: a
            for a in MediaAsset.objects.filter(
                id__in=v["media_asset_ids"], owner=request.user, status=MediaAsset.STATUS_READY
            )
        }
        if len(assets_by_id) != len(set(v["media_asset_ids"])):
            raise DomainError("One or more media files could not be found.", code="invalid_media")

        listings = []
        if v["listing_ids"]:
            listings = list(
                VendorProduct.objects.filter(id__in=v["listing_ids"], vendor=vendor, status=VendorProduct.STATUS_ACTIVE)
            )
            if len(listings) != len(set(v["listing_ids"])):
                raise DomainError("Only your own active listings can be attached to a post.", code="invalid_listing")

        with transaction.atomic():
            post = Post.objects.create(
                vendor=vendor,
                kind=v["kind"],
                caption=v["caption"].strip(),
                comments_enabled=v["comments_enabled"],
                offer_valid_until=v["offer_valid_until"],
            )
            PostMedia.objects.bulk_create(
                [
                    PostMedia(post=post, asset=assets_by_id[aid], position=i)
                    for i, aid in enumerate(v["media_asset_ids"])
                ]
            )
            if listings:
                post.linked_listings.set(listings)

        services.notify_followers_of_new_post(post)
        audit.record("post.created", request=request, target=post, role="vendor")
        return Response(PostSerializer(_post_with_relations(post.id)).data, status=status.HTTP_201_CREATED)


class VendorPostsPublicView(APIView):
    """GET /vendors/{handle}/posts — the profile's "Posts" tab. Public; published only."""

    permission_classes = [AllowAny]

    @extend_schema(responses=PostSerializer(many=True))
    def get(self, request, handle):
        vendor = _active_vendor_by_handle(handle)
        qs = _post_qs().filter(vendor=vendor, status=Post.STATUS_PUBLISHED).order_by("-created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(PostSerializer(page, many=True).data)


class PostDetailView(APIView):
    """GET is public for a published post (the customer Post Detail screen — master prompt §15);
    a hidden/removed post 404s for everyone except the owning vendor, so moderation never leaks
    through a direct link. PATCH/DELETE are vendor-owner-only."""

    def get_permissions(self):
        return [AllowAny()] if self.request.method == "GET" else [IsVendor()]

    @extend_schema(responses=PostSerializer)
    def get(self, request, post_id):
        try:
            post = _post_with_relations(post_id)
        except Post.DoesNotExist as exc:
            raise Http404 from exc
        is_owner = request.user.is_authenticated and post.vendor.owner_id == request.user.id
        if post.status != Post.STATUS_PUBLISHED and not is_owner:
            raise Http404
        return Response(PostSerializer(post).data)

    @extend_schema(request=PostUpdateSerializer, responses=PostSerializer)
    def patch(self, request, post_id):
        vendor = my_vendor(request.user)
        post = get_object_or_404(Post, id=post_id, vendor=vendor)
        s = PostUpdateSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        if "caption" in v:
            post.caption = v["caption"].strip()
        if "comments_enabled" in v:
            post.comments_enabled = v["comments_enabled"]
        post.save(update_fields=["caption", "comments_enabled", "updated_at"])
        if "listing_ids" in v:
            listings = list(
                VendorProduct.objects.filter(id__in=v["listing_ids"], vendor=vendor, status=VendorProduct.STATUS_ACTIVE)
            )
            if len(listings) != len(set(v["listing_ids"])):
                raise DomainError("Only your own active listings can be attached to a post.", code="invalid_listing")
            post.linked_listings.set(listings)
        audit.record("post.updated", request=request, target=post, role="vendor")
        return Response(PostSerializer(_post_with_relations(post.id)).data)

    @extend_schema(responses={204: None})
    def delete(self, request, post_id):
        vendor = my_vendor(request.user)
        post = get_object_or_404(Post, id=post_id, vendor=vendor)
        audit.record("post.deleted", request=request, target=post, role="vendor")  # before delete() clears post.pk
        post.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReportPostView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ReportSubmitThrottle]

    @extend_schema(request=ReportPostSerializer, responses={201: None})
    def post(self, request, post_id):
        post = get_object_or_404(Post, id=post_id)
        s = ReportPostSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        Report.objects.create(
            reporter=request.user,
            target_type="post",
            target_id=post.id,
            reason=s.validated_data["reason"],
            details=s.validated_data["details"],
        )
        audit.record("post.reported", request=request, target=post, reason=s.validated_data["reason"])
        return Response({"status": "received"}, status=status.HTTP_201_CREATED)


# --- Reviews -------------------------------------------------------------------------------------


class VendorReviewsView(APIView):
    """GET /vendors/{handle}/reviews — the profile's "Reviews" tab. Public; published only."""

    permission_classes = [AllowAny]

    @extend_schema(responses=ReviewSerializer(many=True))
    def get(self, request, handle):
        vendor = _active_vendor_by_handle(handle)
        qs = (
            Review.objects.filter(vendor=vendor, status=Review.STATUS_PUBLISHED)
            .select_related("author", "author__privacy", "listing")
            .order_by("-created_at")
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(ReviewSerializer(page, many=True).data)


class ListingReviewsView(APIView):
    """GET /listings/{id}/reviews (master prompt §38's `/products/{id}/reviews`, mapped onto this
    project's own "listing" vocabulary — see docs/API.md conventions)."""

    permission_classes = [AllowAny]

    @extend_schema(responses=ReviewSerializer(many=True))
    def get(self, request, listing_id):
        listing = get_object_or_404(VendorProduct.objects.exclude(status=VendorProduct.STATUS_DELETED), id=listing_id)
        qs = (
            Review.objects.filter(listing=listing, status=Review.STATUS_PUBLISHED)
            .select_related("author", "author__privacy")
            .order_by("-created_at")
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(ReviewSerializer(page, many=True).data)


class ReviewReplyView(APIView):
    """POST /reviews/{id}/reply — vendor-owner-only (404, not 403, for someone else's review —
    same "don't confirm it exists" shape `VendorProductDetailView` already uses)."""

    permission_classes = [IsVendor]

    @extend_schema(request=ReviewReplySerializer, responses=ReviewSerializer)
    def post(self, request, review_id):
        vendor = my_vendor(request.user)
        review = get_object_or_404(
            Review.objects.select_related("author", "author__privacy"), id=review_id, vendor=vendor
        )
        s = ReviewReplySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        review.vendor_reply = s.validated_data["vendor_reply"].strip()
        review.vendor_replied_at = timezone.now()
        review.save(update_fields=["vendor_reply", "vendor_replied_at", "updated_at"])
        notifications.notify(
            review.author,
            kind="review_reply",
            title="Vendor replied to your review",
            body=f"{vendor.shop_name}: {review.vendor_reply[:150]}",
            data={"vendor_handle": vendor.handle},
        )
        audit.record("review.replied", request=request, target=review, role="vendor")
        return Response(ReviewSerializer(review).data)


class MyReviewsView(APIView):
    """GET /reviews/mine — the customer's own "My Reviews" (master prompt §29). Every status is
    shown (not just published) so a customer can see a review of theirs was moderated, rather than
    have it silently vanish."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=MyReviewSerializer(many=True))
    def get(self, request):
        qs = (
            Review.objects.filter(author=request.user)
            .select_related("vendor", "author", "author__privacy", "listing")
            .order_by("-created_at")
        )
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(MyReviewSerializer(page, many=True).data)


class ReportReviewView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ReportSubmitThrottle]

    @extend_schema(request=ReportReviewSerializer, responses={201: None})
    def post(self, request, review_id):
        review = get_object_or_404(Review, id=review_id)
        s = ReportReviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        Report.objects.create(
            reporter=request.user,
            target_type="review",
            target_id=review.id,
            reason=s.validated_data["reason"],
            details=s.validated_data["details"],
        )
        audit.record("review.reported", request=request, target=review, reason=s.validated_data["reason"])
        return Response({"status": "received"}, status=status.HTTP_201_CREATED)
