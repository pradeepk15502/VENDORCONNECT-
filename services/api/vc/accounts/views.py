from django.conf import settings
from django.contrib.auth import authenticate
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from vc.audit import service as audit
from vc.core.exceptions import DomainError

from . import otp
from .models import PrivacySettings, User
from .serializers import (
    AccessSerializer,
    AdminPasswordSerializer,
    LoginResultSerializer,
    MeSerializer,
    OtpRequestSerializer,
    OtpSentSerializer,
    OtpVerifySerializer,
    RefreshSerializer,
)
from .throttles import AdminLoginThrottle, OtpRequestIpThrottle, OtpVerifyIpThrottle
from .tokens import clear_refresh_cookie, issue_tokens, set_refresh_cookie

CSRF_HEADER = "X-Requested-With"  # must be present when the refresh cookie is used


def _otp_response(issued, http_status=status.HTTP_200_OK):
    body = {
        "sent": True,
        "expires_in": settings.OTP_TTL_SECONDS,
        "resend_after": settings.OTP_RESEND_COOLDOWN_SECONDS,
    }
    if settings.OTP_DEV_ECHO:
        body["dev_otp"] = issued.code
    return Response(body, status=http_status)


class OtpRequestView(APIView):
    """Send a login code by SMS. Same response whether or not the number is registered."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [OtpRequestIpThrottle]

    @extend_schema(request=OtpRequestSerializer, responses=OtpSentSerializer)
    def post(self, request):
        s = OtpRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        issued = otp.issue_otp(s.validated_data["phone"], ip_hash=audit.hash_ip(audit.client_ip(request)))
        return _otp_response(issued)


class OtpVerifyView(APIView):
    """Verify code → create account if new → return access token (+ refresh cookie)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [OtpVerifyIpThrottle]

    @extend_schema(request=OtpVerifySerializer, responses=LoginResultSerializer)
    def post(self, request):
        s = OtpVerifySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        phone, purpose = data["phone"], data["purpose"]
        otp.verify_otp(phone, data["code"], purpose=purpose)

        with transaction.atomic():
            user = User.objects.filter(phone=phone).first()
            is_new = user is None
            if purpose == "admin":
                if user is None or not (
                    user.has_role("admin") or user.has_role("moderator") or user.has_role("support")
                ):
                    raise DomainError("Not allowed.", code="permission_denied", status_code=403)
            if is_new:
                user = User.objects.create_user(
                    phone=phone, name=data.get("name", ""), language=data.get("language", "en")
                )
                PrivacySettings.objects.create(user=user)
            if not user.is_active or user.suspended_at:
                raise DomainError(
                    "This account is suspended. Contact support.", code="account_suspended", status_code=403
                )
            if user.phone_verified_at is None:
                user.phone_verified_at = timezone.now()
            if data.get("name") and not user.name:
                user.name = data["name"]
            user.last_login = timezone.now()
            user.save(update_fields=["phone_verified_at", "name", "last_login"])

        access, refresh = issue_tokens(user, admin_session=purpose == "admin")
        audit.record("auth.login", request=request, actor=user, target=user, purpose=purpose, new_user=is_new)
        body = {"access": access, "is_new_user": is_new, "user": MeSerializer(user).data}
        if data["refresh_in_body"]:
            body["refresh"] = refresh
        response = Response(body)
        set_refresh_cookie(response, refresh)
        return response


class AdminPasswordView(APIView):
    """Admin step 1: password. On success an OTP is sent (step 2 = otp/verify with purpose=admin)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [AdminLoginThrottle]

    @extend_schema(request=AdminPasswordSerializer, responses=OtpSentSerializer)
    def post(self, request):
        s = AdminPasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = authenticate(request, phone=s.validated_data["phone"], password=s.validated_data["password"])
        if user is None or not any(user.has_role(r) for r in ("admin", "moderator", "support")):
            audit.record("auth.admin_password_failed", request=request, phone_suffix=s.validated_data["phone"][-4:])
            raise DomainError("Invalid credentials.", code="invalid_credentials", status_code=401)
        issued = otp.issue_otp(user.phone, purpose="admin", ip_hash=audit.hash_ip(audit.client_ip(request)))
        return _otp_response(issued)


def _refresh_from_request(request):
    token = request.data.get("refresh") if hasattr(request, "data") else None
    if token:
        return token, False
    cookie = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
    if cookie:
        # Cookie auth → require a custom header, which cross-site forms cannot send (CSRF defence).
        if request.headers.get(CSRF_HEADER) != "vendorconnect":
            raise DomainError("Missing request header.", code="csrf_failed", status_code=403)
        return cookie, True
    raise DomainError("Please log in again.", code="not_authenticated", status_code=401)


class RefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(request=RefreshSerializer, responses=AccessSerializer)
    def post(self, request):
        raw, from_cookie = _refresh_from_request(request)
        try:
            old = RefreshToken(raw)
            user = User.objects.get(id=old["sub"])
        except (TokenError, User.DoesNotExist, KeyError):
            response = Response(
                {"error": {"code": "not_authenticated", "message": "Please log in again.", "details": {}}},
                status=401,
            )
            clear_refresh_cookie(response)
            return response
        if not user.is_active or user.suspended_at:
            raise DomainError("This account is suspended.", code="account_suspended", status_code=403)
        old.blacklist()  # rotation: each refresh token is single-use
        access, refresh = issue_tokens(user, admin_session=bool(old.get("adm", False)))
        body = {"access": access}
        if not from_cookie:
            body["refresh"] = refresh
        response = Response(body)
        if from_cookie:
            set_refresh_cookie(response, refresh)
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(request=RefreshSerializer, responses={204: None})
    def post(self, request):
        try:
            raw, _ = _refresh_from_request(request)
            RefreshToken(raw).blacklist()
        except (DomainError, TokenError):
            pass
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = MeSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user
