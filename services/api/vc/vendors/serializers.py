from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from vc.catalog.models import Category
from vc.core.geo import INDIA_BOUNDS, make_point

from .models import DeliverySettings, Vendor, VendorLocation, VendorProfile


class LocationInSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=6.0, max_value=37.5, help_text="India bounds")
    lng = serializers.FloatField(min_value=68.0, max_value=97.5)
    address_line = serializers.CharField(max_length=250)
    landmark = serializers.CharField(max_length=120, required=False, allow_blank=True)
    locality = serializers.CharField(max_length=120, required=False, allow_blank=True)
    city = serializers.CharField(max_length=80)
    state = serializers.CharField(max_length=80, required=False, allow_blank=True)
    pincode = serializers.RegexField(r"^\d{6}$", required=False, allow_blank=True)


class DeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliverySettings
        fields = [
            "delivery_enabled",
            "pickup_enabled",
            "radius_km",
            "min_order_amount",
            "delivery_fee",
            "free_delivery_above",
        ]

    def validate(self, attrs):
        d = attrs.get("delivery_enabled", getattr(self.instance, "delivery_enabled", False))
        p = attrs.get("pickup_enabled", getattr(self.instance, "pickup_enabled", True))
        if not d and not p:
            raise serializers.ValidationError("Enable pickup, delivery, or both.")
        return attrs


class VendorCreateSerializer(serializers.Serializer):
    shop_name = serializers.CharField(max_length=120, min_length=2)
    category_slugs = serializers.ListField(child=serializers.SlugField(), min_length=1, max_length=5)
    location = LocationInSerializer()
    public_phone = serializers.CharField(max_length=16, required=False, allow_blank=True)
    bio = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate_category_slugs(self, slugs):
        cats = list(Category.objects.filter(slug__in=slugs, is_active=True))
        if len(cats) != len(set(slugs)):
            raise serializers.ValidationError("Unknown category.")
        return cats

    def validate_public_phone(self, value):
        if not value:
            return value
        from vc.accounts.phone import InvalidPhone, normalize_phone

        try:
            return normalize_phone(value)
        except InvalidPhone as exc:
            raise serializers.ValidationError(str(exc)) from exc

    @transaction.atomic
    def create(self, validated):
        from .handles import create_vendor_with_handle

        user = self.context["request"].user
        loc = validated["location"]
        vendor = create_vendor_with_handle(
            owner=user,
            shop_name=validated["shop_name"].strip(),
            public_phone=validated.get("public_phone") or user.phone,
            onboarding_step="photos",
        )
        vendor.categories.set(validated["category_slugs"])
        VendorProfile.objects.create(vendor=vendor, bio=validated.get("bio", ""))
        VendorLocation.objects.create(
            vendor=vendor,
            point=make_point(loc["lat"], loc["lng"]),
            **{k: v for k, v in loc.items() if k not in ("lat", "lng")},
        )
        DeliverySettings.objects.create(vendor=vendor)  # default: pickup only
        user.add_role("vendor")
        return vendor


class LocationOutSerializer(serializers.Serializer):
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    address_line = serializers.CharField()
    landmark = serializers.CharField()
    locality = serializers.CharField()
    city = serializers.CharField()
    pincode = serializers.CharField()


class VendorPublicSerializer(serializers.ModelSerializer):
    """What any customer sees. No owner info, no internal ids beyond the stable UUID."""

    vendor_id = serializers.CharField(source="display_handle")
    verified = serializers.SerializerMethodField()
    categories = serializers.SlugRelatedField(many=True, read_only=True, slug_field="slug")
    location = serializers.SerializerMethodField()
    delivery = DeliverySerializer(read_only=True)
    bio = serializers.CharField(source="profile.bio", default="")
    is_following = serializers.SerializerMethodField()

    class Meta:
        model = Vendor
        fields = [
            "handle",
            "vendor_id",
            "shop_name",
            "verified",
            "is_open",
            "status_changed_at",
            "public_phone",
            "categories",
            "rating_avg",
            "rating_count",
            "follower_count",
            "is_following",
            "location",
            "delivery",
            "bio",
        ]

    @extend_schema_field(serializers.BooleanField())
    def get_verified(self, obj):
        return obj.verification_status == Vendor.VERIFY_VERIFIED

    @extend_schema_field(serializers.BooleanField())
    def get_is_following(self, obj) -> bool:
        """Phase 9 (ARCHITECTURE D30). The caller precomputes a `following_ids` set in one bulk
        query and passes it via context — never a per-row query here (master prompt §46: avoid
        N+1 queries on a list of up to `page_size` vendors). Defaults to a single-object fallback
        query only where a view genuinely has just the one vendor and skipped that step."""
        following_ids = self.context.get("following_ids")
        if following_ids is not None:
            return obj.id in following_ids
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            from vc.social.models import Follow

            return Follow.objects.filter(user=request.user, vendor_id=obj.id).exists()
        return False

    @extend_schema_field(LocationOutSerializer(allow_null=True))
    def get_location(self, obj):
        loc = getattr(obj, "location", None)
        if loc is None:
            return None
        return {
            "lat": round(loc.point.y, 6),
            "lng": round(loc.point.x, 6),
            "address_line": loc.address_line,
            "landmark": loc.landmark,
            "locality": loc.locality,
            "city": loc.city,
            "pincode": loc.pincode,
        }


class VendorOwnerSerializer(VendorPublicSerializer):
    class Meta(VendorPublicSerializer.Meta):
        fields = VendorPublicSerializer.Meta.fields + ["status", "verification_status", "onboarding_step", "created_at"]


class VendorListQuerySerializer(serializers.Serializer):
    """Query params for GET /vendors (nearby list — Phase 3). `lat`/`lng` are the customer's
    current position, sent per request and never stored (ARCHITECTURE D11), same as /search."""

    lat = serializers.FloatField(min_value=INDIA_BOUNDS["lat"][0], max_value=INDIA_BOUNDS["lat"][1])
    lng = serializers.FloatField(min_value=INDIA_BOUNDS["lng"][0], max_value=INDIA_BOUNDS["lng"][1])
    category = serializers.SlugField(required=False, allow_blank=True, default="")
    radius_km = serializers.FloatField(required=False, min_value=0.5, max_value=settings.SEARCH_RADIUS_KM_MAX)
    # Phase 6 filters (ARCHITECTURE D26) — opt-in, off by default; omitting them keeps the existing
    # "closed shops shown, ranked lower" default (D9) unchanged.
    open_now = serializers.BooleanField(required=False, default=False)
    delivery = serializers.BooleanField(required=False, default=False)
    pickup = serializers.BooleanField(required=False, default=False)

    def validate_category(self, value):
        if value and not Category.objects.filter(slug=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown category.")
        return value


class VendorListSerializer(VendorPublicSerializer):
    """A vendor card for browsing (Home 'Shops near you', the Vendors tab) — the public shape
    plus distance, from a queryset annotated with `.annotate(distance=Distance(...))`."""

    distance_km = serializers.SerializerMethodField()

    class Meta(VendorPublicSerializer.Meta):
        fields = VendorPublicSerializer.Meta.fields + ["distance_km"]

    @extend_schema_field(serializers.FloatField())
    def get_distance_km(self, obj) -> float:
        return round(obj.distance.km, 2)


class VendorUpdateSerializer(serializers.ModelSerializer):
    bio = serializers.CharField(max_length=500, required=False, allow_blank=True)

    class Meta:
        model = Vendor
        fields = ["shop_name", "public_phone", "bio"]  # handle is immutable by design

    def update(self, instance, validated):
        bio = validated.pop("bio", None)
        instance = super().update(instance, validated)
        if bio is not None:
            VendorProfile.objects.update_or_create(vendor=instance, defaults={"bio": bio})
        return instance


class VendorSummarySerializer(serializers.Serializer):
    """GET /vendors/me/summary (Phase 5) — the vendor dashboard's stat tiles, computed for real
    from the vendor's own listings in one aggregate query (ARCHITECTURE D25). No orders/sales
    fields here: those need the order system (Phase 8) and showing a fake 0 until then would be
    exactly the fabricated data the project brief forbids — the dashboard omits those tiles."""

    is_open = serializers.BooleanField()
    status_changed_at = serializers.DateTimeField(allow_null=True)
    product_count = serializers.IntegerField()
    low_stock_count = serializers.IntegerField()
    out_of_stock_count = serializers.IntegerField()


class ShopStatusSerializer(serializers.Serializer):
    is_open = serializers.BooleanField()

    def save(self, vendor):
        if vendor.is_open != self.validated_data["is_open"]:
            vendor.is_open = self.validated_data["is_open"]
            vendor.status_changed_at = timezone.now()
            vendor.save(update_fields=["is_open", "status_changed_at", "updated_at"])
        return vendor


# --- Admin (Phase 11, ARCHITECTURE D32) ----------------------------------------------------------


class _AdminOwnerRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    phone = serializers.CharField()


class AdminVendorListSerializer(serializers.ModelSerializer):
    owner = _AdminOwnerRefSerializer(read_only=True)
    categories = serializers.SlugRelatedField(many=True, read_only=True, slug_field="slug")
    city = serializers.CharField(source="location.city", default="")

    class Meta:
        model = Vendor
        fields = [
            "handle",
            "shop_name",
            "owner",
            "status",
            "verification_status",
            "city",
            "categories",
            "is_open",
            "rating_avg",
            "rating_count",
            "follower_count",
            "created_at",
        ]


class AdminVendorDetailSerializer(AdminVendorListSerializer):
    location = serializers.SerializerMethodField()
    hours = serializers.SerializerMethodField()
    delivery = DeliverySerializer(read_only=True)
    product_count = serializers.SerializerMethodField()
    post_count = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    order_count = serializers.SerializerMethodField()

    class Meta(AdminVendorListSerializer.Meta):
        fields = AdminVendorListSerializer.Meta.fields + [
            "public_phone",
            "location",
            "hours",
            "delivery",
            "product_count",
            "post_count",
            "review_count",
            "order_count",
            "verified_at",
            "status_changed_at",
        ]

    @extend_schema_field(LocationOutSerializer(allow_null=True))
    def get_location(self, obj):
        loc = getattr(obj, "location", None)
        if loc is None:
            return None
        return {
            "lat": round(loc.point.y, 6),
            "lng": round(loc.point.x, 6),
            "address_line": loc.address_line,
            "landmark": loc.landmark,
            "locality": loc.locality,
            "city": loc.city,
            "pincode": loc.pincode,
        }

    @extend_schema_field(
        serializers.ListField(child=serializers.DictField()),
    )
    def get_hours(self, obj):
        return [
            {"weekday": h.weekday, "opens_at": h.opens_at.isoformat(), "closes_at": h.closes_at.isoformat()}
            for h in obj.hours.all()
        ]

    @extend_schema_field(serializers.IntegerField())
    def get_product_count(self, obj) -> int:
        from vc.catalog.models import VendorProduct

        return obj.listings.exclude(status=VendorProduct.STATUS_DELETED).count()

    @extend_schema_field(serializers.IntegerField())
    def get_post_count(self, obj) -> int:
        return obj.posts.count()

    @extend_schema_field(serializers.IntegerField())
    def get_review_count(self, obj) -> int:
        return obj.reviews.count()

    @extend_schema_field(serializers.IntegerField())
    def get_order_count(self, obj) -> int:
        return obj.orders.count()


class AdminVendorVerifyDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=[Vendor.VERIFY_VERIFIED, Vendor.VERIFY_REJECTED])
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class AdminVendorSuspendSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)
