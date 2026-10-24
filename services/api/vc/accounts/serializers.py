from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from vc.core.geo import INDIA_BOUNDS

from .models import Address, User
from .phone import InvalidPhone, normalize_phone

# --- Admin (Phase 11, ARCHITECTURE D32) ----------------------------------------------------------


class _AdminVendorRefSerializer(serializers.Serializer):
    handle = serializers.CharField()
    shop_name = serializers.CharField()


class AdminUserListSerializer(serializers.ModelSerializer):
    """List row. No password/OTP/token fields — those never leave the auth layer at all (master
    prompt §7/§24)."""

    roles = serializers.SerializerMethodField()
    vendor = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "name",
            "phone",
            "email",
            "roles",
            "is_active",
            "suspended_at",
            "vendor",
            "date_joined",
            "last_login",
        ]

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_roles(self, obj):
        return sorted(obj.role_codes())

    @extend_schema_field(_AdminVendorRefSerializer(allow_null=True))
    def get_vendor(self, obj):
        # Phase 12 hardening: mirrors role_codes() below — `.exclude().first()` always re-queries even
        # after prefetch_related, so when the view already prefetched a (closed-vendors-excluded)
        # `vendors` queryset, read it from the cache instead of issuing one query per row.
        if "vendors" in getattr(obj, "_prefetched_objects_cache", {}):
            v = next(iter(obj.vendors.all()), None)
        else:
            v = obj.vendors.exclude(status="closed_permanently").only("handle", "shop_name").first()
        return {"handle": v.handle, "shop_name": v.shop_name} if v else None


class AdminUserDetailSerializer(AdminUserListSerializer):
    order_count = serializers.SerializerMethodField()
    reports_filed_count = serializers.SerializerMethodField()
    reports_against_count = serializers.SerializerMethodField()
    suspension_reason = serializers.CharField(read_only=True)

    class Meta(AdminUserListSerializer.Meta):
        fields = AdminUserListSerializer.Meta.fields + [
            "suspension_reason",
            "order_count",
            "reports_filed_count",
            "reports_against_count",
        ]

    @extend_schema_field(serializers.IntegerField())
    def get_order_count(self, obj) -> int:
        return obj.orders.count()

    @extend_schema_field(serializers.IntegerField())
    def get_reports_filed_count(self, obj) -> int:
        return obj.reports_made.count()

    @extend_schema_field(serializers.IntegerField())
    def get_reports_against_count(self, obj) -> int:
        from vc.moderation.models import Report

        return Report.objects.filter(target_type="user", target_id=obj.id).count()


class AdminUserSuspendSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)


class PhoneField(serializers.CharField):
    def to_internal_value(self, data):
        try:
            return normalize_phone(super().to_internal_value(data))
        except InvalidPhone as exc:
            raise serializers.ValidationError(str(exc)) from exc


class OtpRequestSerializer(serializers.Serializer):
    phone = PhoneField(max_length=20)


class OtpVerifySerializer(serializers.Serializer):
    phone = PhoneField(max_length=20)
    code = serializers.RegexField(r"^\d{4,8}$", error_messages={"invalid": "Enter the code from the SMS."})
    purpose = serializers.ChoiceField(choices=["login", "admin"], default="login")
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    language = serializers.ChoiceField(choices=[c for c, _ in settings.LANGUAGES], required=False)
    refresh_in_body = serializers.BooleanField(default=False, help_text="native clients only")


class AdminPasswordSerializer(serializers.Serializer):
    phone = PhoneField(max_length=20)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)


class VendorRefSerializer(serializers.Serializer):
    handle = serializers.CharField()
    shop_name = serializers.CharField()


class OtpSentSerializer(serializers.Serializer):
    sent = serializers.BooleanField()
    expires_in = serializers.IntegerField()
    resend_after = serializers.IntegerField()
    dev_otp = serializers.CharField(required=False, help_text="development only")


class AccessSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField(required=False, help_text="only when sent in the body (native clients)")


class MeSerializer(serializers.ModelSerializer):
    roles = serializers.SerializerMethodField()
    phone = serializers.CharField(read_only=True)
    vendor = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "phone", "name", "email", "language", "roles", "vendor", "date_joined"]
        read_only_fields = ["id", "phone", "roles", "vendor", "date_joined"]

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_roles(self, obj):
        return sorted(obj.role_codes())

    @extend_schema_field(VendorRefSerializer(allow_null=True))
    def get_vendor(self, obj):
        v = obj.vendors.exclude(status="closed_permanently").only("handle", "shop_name").first()
        return {"handle": v.handle, "shop_name": v.shop_name} if v else None

    def validate_language(self, value):
        if value not in dict(settings.LANGUAGES):
            raise serializers.ValidationError("Unsupported language.")
        return value


class LoginResultSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField(required=False, help_text="only with refresh_in_body=true")
    is_new_user = serializers.BooleanField()
    user = MeSerializer()


# --- Addresses (Phase 8) ------------------------------------------------------------------------


class AddressSerializer(serializers.ModelSerializer):
    """Read shape. `lat`/`lng` are null when the address was saved without a captured location
    (text-only entry is allowed — ARCHITECTURE D29 — but such an address can't be used for delivery
    eligibility, since that needs real coordinates to measure distance from)."""

    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()

    class Meta:
        model = Address
        fields = [
            "id",
            "label",
            "line1",
            "line2",
            "landmark",
            "city",
            "state",
            "pincode",
            "lat",
            "lng",
            "is_default",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_lat(self, obj) -> float | None:
        return obj.location.y if obj.location else None

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_lng(self, obj) -> float | None:
        return obj.location.x if obj.location else None


class AddressWriteSerializer(serializers.ModelSerializer):
    """Write shape for POST/PATCH. `lat`/`lng` are optional (see `AddressSerializer`) but must be
    given together — a half-set coordinate isn't a usable point."""

    lat = serializers.FloatField(
        min_value=INDIA_BOUNDS["lat"][0], max_value=INDIA_BOUNDS["lat"][1], required=False, allow_null=True
    )
    lng = serializers.FloatField(
        min_value=INDIA_BOUNDS["lng"][0], max_value=INDIA_BOUNDS["lng"][1], required=False, allow_null=True
    )

    class Meta:
        model = Address
        fields = ["label", "line1", "line2", "landmark", "city", "state", "pincode", "lat", "lng", "is_default"]
        extra_kwargs = {
            "label": {"required": False},
            "line1": {"required": False},
            "city": {"required": False},
            "pincode": {"required": False},
        }

    def validate(self, attrs):
        has_lat, has_lng = "lat" in attrs and attrs["lat"] is not None, "lng" in attrs and attrs["lng"] is not None
        if has_lat != has_lng:
            raise serializers.ValidationError("Provide both lat and lng, or neither.")
        if self.instance is None:
            for field in ("line1", "city", "pincode"):
                if not attrs.get(field):
                    raise serializers.ValidationError({field: "This field is required."})
        return attrs

    def create(self, validated):
        from vc.core.geo import make_point  # local import avoids a module-level cycle with geo helpers

        lat, lng = validated.pop("lat", None), validated.pop("lng", None)
        if lat is not None:
            validated["location"] = make_point(lat, lng)
        validated["user"] = self.context["request"].user
        return super().create(validated)

    def update(self, instance, validated):
        from vc.core.geo import make_point

        if "lat" in validated:
            lat, lng = validated.pop("lat"), validated.pop("lng", None)
            instance.location = make_point(lat, lng) if lat is not None else None
        return super().update(instance, validated)
