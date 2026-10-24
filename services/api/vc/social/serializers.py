from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from vc.assets.serializers import MediaAssetSerializer
from vc.vendors.serializers import VendorPublicSerializer

from .models import Post, PostMedia, Review

# --- Follow ------------------------------------------------------------------------------------


class FollowedVendorSerializer(VendorPublicSerializer):
    """A vendor card for `GET /following` — the public shape plus distance, when the caller sent
    `lat`/`lng` (same optional-distance pattern as `/vendors`); `null` otherwise."""

    distance_km = serializers.SerializerMethodField()

    class Meta(VendorPublicSerializer.Meta):
        fields = VendorPublicSerializer.Meta.fields + ["distance_km"]

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_distance_km(self, obj):
        d = getattr(obj, "distance", None)
        return round(d.km, 2) if d is not None else None


# --- Posts ---------------------------------------------------------------------------------------


class PostVendorRefSerializer(serializers.Serializer):
    handle = serializers.CharField()
    vendor_id = serializers.CharField(source="display_handle")
    shop_name = serializers.CharField()
    is_open = serializers.BooleanField()


class PostMediaItemSerializer(serializers.Serializer):
    """One `PostMedia` row, resolved through the same `MediaAssetSerializer` a fresh upload returns
    — a post's media is never a second copy of the file, always a reference to its `MediaAsset`."""

    id = serializers.UUIDField(source="asset.id")
    position = serializers.IntegerField()
    kind = serializers.CharField(source="asset.kind")
    url = serializers.SerializerMethodField()
    variant_urls = serializers.SerializerMethodField()

    @extend_schema_field(serializers.URLField())
    def get_url(self, obj: PostMedia) -> str:
        return MediaAssetSerializer(obj.asset).data["url"]

    @extend_schema_field(serializers.DictField(child=serializers.URLField()))
    def get_variant_urls(self, obj: PostMedia) -> dict:
        return MediaAssetSerializer(obj.asset).data["variant_urls"]


class PostLinkedListingSerializer(serializers.Serializer):
    """A minimal, real product card for "Fresh Tomato Stock — ₹30/kg — In Stock" inside a post —
    only what's needed to render that card and to link through to `/listings/{id}` (master prompt
    §12: "Clicking the product must open the real product detail page")."""

    id = serializers.UUIDField()
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    unit = serializers.CharField()
    unit_quantity = serializers.DecimalField(max_digits=8, decimal_places=2)
    availability = serializers.CharField()


class PostSerializer(serializers.ModelSerializer):
    vendor = PostVendorRefSerializer()
    media = PostMediaItemSerializer(many=True)
    linked_listings = PostLinkedListingSerializer(many=True)

    class Meta:
        model = Post
        fields = [
            "id",
            "vendor",
            "kind",
            "caption",
            "media",
            "linked_listings",
            "comments_enabled",
            "status",
            "like_count",
            "offer_valid_until",
            "created_at",
            "updated_at",
        ]


POST_KINDS = [k for k, _ in Post.KIND_CHOICES]


class PostCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=POST_KINDS, default="photo")
    caption = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    media_asset_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=6)
    listing_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)
    comments_enabled = serializers.BooleanField(required=False, default=False)
    offer_valid_until = serializers.DateTimeField(required=False, allow_null=True, default=None)


class PostUpdateSerializer(serializers.Serializer):
    """Edit surface (master prompt §14 "Edit where appropriate") — caption and the attached
    products only. Media and kind are immutable after publish: reworking a post's pictures is, in
    effect, a new post, and keeping that boundary keeps `MediaAsset` ownership/validation simple."""

    caption = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    listing_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    comments_enabled = serializers.BooleanField(required=False)


REPORT_POST_REASONS = ["spam", "misleading", "inappropriate", "fake_offer", "other"]
REPORT_REVIEW_REASONS = ["spam", "abuse", "fake", "offensive", "other"]


class ReportPostSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=REPORT_POST_REASONS)
    details = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")


class ReportReviewSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=REPORT_REVIEW_REASONS)
    details = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")


# --- Reviews -----------------------------------------------------------------------------------


class ReviewListingRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


def _author_display_name(user) -> str:
    """Respects the existing `PrivacySettings.show_reviews_publicly` toggle (Phase 0 schema,
    ARCHITECTURE.md) — a customer who has turned it off is shown as "Anonymous customer" rather
    than by name, without hiding the review's content itself. Defensive default (visible) matches
    the field's own model default for any account somehow missing the row."""

    show = getattr(getattr(user, "privacy", None), "show_reviews_publicly", True)
    if not show:
        return "Anonymous customer"
    return user.name or "A customer"


class ReviewSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    listing = serializers.SerializerMethodField()
    verified_purchase = serializers.SerializerMethodField()
    order_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Review
        fields = [
            "id",
            "author_name",
            "rating",
            "text",
            "listing",
            "order_id",
            "verified_purchase",
            "vendor_reply",
            "vendor_replied_at",
            "created_at",
        ]

    @extend_schema_field(serializers.CharField())
    def get_author_name(self, obj: Review) -> str:
        return _author_display_name(obj.author)

    @extend_schema_field(ReviewListingRefSerializer(allow_null=True))
    def get_listing(self, obj: Review):
        if obj.listing_id is None:
            return None
        return {"id": obj.listing_id, "name": obj.listing.name}

    @extend_schema_field(serializers.BooleanField())
    def get_verified_purchase(self, obj: Review) -> bool:
        return obj.order_id is not None


class ReviewCreateSerializer(serializers.Serializer):
    """Used from `POST /orders/{id}/reviews` (vc.orders.views) — `context["order"]` is the
    already-authorized, already-completed order the review is being written for (master prompt
    §19/§20: eligibility and ownership are resolved server-side before this ever runs)."""

    rating = serializers.IntegerField(min_value=1, max_value=5)
    text = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    listing_id = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs):
        order = self.context["order"]
        listing_id = attrs.get("listing_id")
        if listing_id and not order.items.filter(listing_id=listing_id).exists():
            raise serializers.ValidationError({"listing_id": "This item was not part of that order."})
        return attrs


class ReviewReplySerializer(serializers.Serializer):
    vendor_reply = serializers.CharField(max_length=1000, min_length=1)


class MyReviewSerializer(ReviewSerializer):
    """`GET /reviews/mine` (master prompt §29's Customer Profile "My Reviews") — the one place a
    review is shown to its own author with which shop it's for, and its moderation `status`, since
    a customer should be able to see a review of theirs was hidden rather than have it vanish
    silently (master prompt §25's audit-not-erase rule, from the author's own side)."""

    vendor = PostVendorRefSerializer()

    class Meta(ReviewSerializer.Meta):
        fields = [*ReviewSerializer.Meta.fields, "vendor", "status"]


class FollowStateSerializer(serializers.Serializer):
    following = serializers.BooleanField()
    follower_count = serializers.IntegerField()
