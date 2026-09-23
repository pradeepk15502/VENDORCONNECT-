from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from vc.catalog.models import Category
from vc.core.geo import make_point

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
            "location",
            "delivery",
            "bio",
        ]

    @extend_schema_field(serializers.BooleanField())
    def get_verified(self, obj):
        return obj.verification_status == Vendor.VERIFY_VERIFIED

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


class ShopStatusSerializer(serializers.Serializer):
    is_open = serializers.BooleanField()

    def save(self, vendor):
        if vendor.is_open != self.validated_data["is_open"]:
            vendor.is_open = self.validated_data["is_open"]
            vendor.status_changed_at = timezone.now()
            vendor.save(update_fields=["is_open", "status_changed_at", "updated_at"])
        return vendor
