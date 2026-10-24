"""Admin moderation surface for Phase 9 posts/reviews/reports (ARCHITECTURE D30).

Deliberately under `/moderation/*`, not `/admin/*` — the broader admin panel (users, vendor
verification, catalog/category CRUD, analytics, settings) is its own future phase (see the
roadmap); this is only the moderation slice the Phase 9 spec explicitly asks for, reusing the same
`IsStaffRole`/`admin_permission` machinery Phase 1's admin login already built. Hiding never
deletes a row — `Post`/`Review` keep a `status` (published/hidden/removed) precisely so a
moderation action leaves an audit trail instead of erasing data (master prompt §25/§26)."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.audit import service as audit
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole, admin_permission
from vc.social import services as social_services
from vc.social.models import Post, Review

from .models import Report
from .serializers import AdminPostSerializer, AdminReviewSerializer, ReportResolveSerializer, ReportSerializer


class ReportListView(APIView):
    permission_classes = [IsStaffRole]

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, required=False, description="open | reviewing | resolved | dismissed"),
            OpenApiParameter("target_type", str, required=False),
        ],
        responses=ReportSerializer(many=True),
    )
    def get(self, request):
        qs = Report.objects.select_related("reporter", "handled_by").order_by("-created_at")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("target_type"):
            qs = qs.filter(target_type=request.query_params["target_type"])
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(ReportSerializer(page, many=True).data)


def _hide_target(target_type: str, target_id) -> None:
    if target_type == "post":
        Post.objects.filter(id=target_id).update(status=Post.STATUS_HIDDEN)
    elif target_type == "review":
        review = Review.objects.filter(id=target_id).first()
        if review is not None:
            review.status = Review.STATUS_HIDDEN
            review.save(update_fields=["status", "updated_at"])
            social_services.recompute_vendor_rating(review.vendor_id)


class ReportResolveView(APIView):
    permission_classes = [admin_permission("moderation.handle_report")]

    @extend_schema(request=ReportResolveSerializer, responses=ReportSerializer)
    def post(self, request, report_id):
        report = get_object_or_404(Report, id=report_id)
        s = ReportResolveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        with transaction.atomic():
            if v["hide_target"] and v["status"] == "resolved":
                _hide_target(report.target_type, report.target_id)
            report.status = v["status"]
            report.resolution = v["resolution"]
            report.handled_by = request.user
            report.save(update_fields=["status", "resolution", "handled_by", "updated_at"])
        audit.record("report.resolved", request=request, target=report, role="admin", new_status=v["status"])
        return Response(ReportSerializer(report).data)


class PostModerationListView(APIView):
    permission_classes = [IsStaffRole]

    @extend_schema(
        parameters=[OpenApiParameter("status", str, required=False), OpenApiParameter("vendor", str, required=False)],
        responses=AdminPostSerializer(many=True),
    )
    def get(self, request):
        qs = Post.objects.select_related("vendor").order_by("-created_at")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("vendor"):
            qs = qs.filter(vendor__handle__iexact=request.query_params["vendor"].lstrip("@"))
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AdminPostSerializer(page, many=True).data)


class PostHideView(APIView):
    permission_classes = [admin_permission("social.moderate_post")]

    @extend_schema(request=None, responses=AdminPostSerializer)
    def post(self, request, post_id):
        post = get_object_or_404(Post.objects.select_related("vendor"), id=post_id)
        post.status = Post.STATUS_HIDDEN
        post.save(update_fields=["status", "updated_at"])
        audit.record("post.hidden", request=request, target=post, role="admin")
        return Response(AdminPostSerializer(post).data)


class PostUnhideView(APIView):
    permission_classes = [admin_permission("social.moderate_post")]

    @extend_schema(request=None, responses=AdminPostSerializer)
    def post(self, request, post_id):
        post = get_object_or_404(Post.objects.select_related("vendor"), id=post_id)
        post.status = Post.STATUS_PUBLISHED
        post.save(update_fields=["status", "updated_at"])
        audit.record("post.unhidden", request=request, target=post, role="admin")
        return Response(AdminPostSerializer(post).data)


class ReviewModerationListView(APIView):
    permission_classes = [IsStaffRole]

    @extend_schema(
        parameters=[OpenApiParameter("status", str, required=False), OpenApiParameter("vendor", str, required=False)],
        responses=AdminReviewSerializer(many=True),
    )
    def get(self, request):
        qs = Review.objects.select_related("vendor", "author").order_by("-created_at")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("vendor"):
            qs = qs.filter(vendor__handle__iexact=request.query_params["vendor"].lstrip("@"))
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AdminReviewSerializer(page, many=True).data)


class ReviewHideView(APIView):
    permission_classes = [admin_permission("social.moderate_review")]

    @extend_schema(request=None, responses=AdminReviewSerializer)
    def post(self, request, review_id):
        review = get_object_or_404(Review.objects.select_related("vendor", "author"), id=review_id)
        review.status = Review.STATUS_HIDDEN
        review.save(update_fields=["status", "updated_at"])
        social_services.recompute_vendor_rating(review.vendor_id)
        audit.record("review.hidden", request=request, target=review, role="admin")
        return Response(AdminReviewSerializer(review).data)


class ReviewUnhideView(APIView):
    permission_classes = [admin_permission("social.moderate_review")]

    @extend_schema(request=None, responses=AdminReviewSerializer)
    def post(self, request, review_id):
        review = get_object_or_404(Review.objects.select_related("vendor", "author"), id=review_id)
        review.status = Review.STATUS_PUBLISHED
        review.save(update_fields=["status", "updated_at"])
        social_services.recompute_vendor_rating(review.vendor_id)
        audit.record("review.unhidden", request=request, target=review, role="admin")
        return Response(AdminReviewSerializer(review).data)
