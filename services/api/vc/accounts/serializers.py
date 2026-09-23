from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import User
from .phone import InvalidPhone, normalize_phone


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
