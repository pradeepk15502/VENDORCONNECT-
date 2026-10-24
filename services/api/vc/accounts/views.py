from django.conf import settings
from django.contrib.auth import authenticate
from django.db import transaction
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from vc.audit import service as audit
from vc.core.exceptions import DomainError
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole, admin_permission
from vc.vendors.models import Vendor

from . import otp
from .models import Address, PrivacySettings, User
from .serializers import (
    AccessSerializer,
    AddressSerializer,
    AddressWriteSerializer,
    AdminPasswordSerializer,
    AdminUserDetailSerializer,
    AdminUserListSerializer,
    AdminUserSuspendSerializer,
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


# --- Addresses (Phase 8) -------------------------------------------------------------------------


def _unset_other_defaults(user, keep_id=None):
    qs = Address.objects.filter(user=user, is_default=True)
    if keep_id is not None:
        qs = qs.exclude(id=keep_id)
    qs.update(is_default=False)


class AddressCollectionView(APIView):
    """A customer's saved delivery addresses — a small, personal, unpaginated list (same shape as
    vendor quick replies: bounded, always fetched in full)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=AddressSerializer(many=True))
    def get(self, request):
        addresses = request.user.addresses.order_by("-is_default", "-created_at")
        return Response(AddressSerializer(addresses, many=True).data)

    @extend_schema(request=AddressWriteSerializer, responses=AddressSerializer)
    @transaction.atomic
    def post(self, request):
        is_first = not request.user.addresses.exists()
        s = AddressWriteSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        make_default = s.validated_data.get("is_default", False) or is_first
        # Unset any existing default *before* inserting the new one — the partial unique index
        # allows only one is_default=True row per user at any instant, including mid-transaction.
        if make_default:
            _unset_other_defaults(request.user)
        address = s.save(is_default=make_default)
        return Response(AddressSerializer(address).data, status=status.HTTP_201_CREATED)


class AddressDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, address_id):
        # Cross-account safety: scoped to request.user, never trusts the id alone (master-prompt §68).
        return get_object_or_404(Address, id=address_id, user=request.user)

    @extend_schema(responses=AddressSerializer)
    def get(self, request, address_id):
        return Response(AddressSerializer(self._get(request, address_id)).data)

    @extend_schema(request=AddressWriteSerializer, responses=AddressSerializer)
    @transaction.atomic
    def patch(self, request, address_id):
        address = self._get(request, address_id)
        s = AddressWriteSerializer(address, data=request.data, context={"request": request}, partial=True)
        s.is_valid(raise_exception=True)
        if s.validated_data.get("is_default") is True:
            _unset_other_defaults(request.user, keep_id=address.id)
        address = s.save()
        return Response(AddressSerializer(address).data)

    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, address_id):
        address = self._get(request, address_id)
        was_default = address.is_default
        address.delete()
        if was_default:
            nxt = request.user.addresses.order_by("-created_at").first()
            if nxt is not None:
                nxt.is_default = True
                nxt.save(update_fields=["is_default", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Admin: user management (Phase 11, ARCHITECTURE D32) -----------------------------------------

_ADMIN_USER_LIST_PARAMETERS = [
    OpenApiParameter("q", str, required=False, description="Search by name or phone (partial match)."),
    OpenApiParameter("role", str, required=False, description="customer | vendor | admin | moderator | support"),
    OpenApiParameter("is_active", bool, required=False),
    OpenApiParameter("page", int, required=False),
    OpenApiParameter("page_size", int, required=False),
]


class AdminUserListView(APIView):
    """GET /admin/users — any staff role may view (master prompt §6); suspend/restore are gated
    separately below by the specific `accounts.manage_users` permission, matching the coarse-list /
    fine-action split every other admin surface in this codebase already uses (moderation, AI)."""

    permission_classes = [IsStaffRole]

    @extend_schema(parameters=_ADMIN_USER_LIST_PARAMETERS, responses=AdminUserListSerializer(many=True))
    def get(self, request):
        # Phase 12 hardening (docs/ARCHITECTURE.md D33): AdminUserListSerializer.get_roles/get_vendor
        # each ran one query per row (role_codes(), vendors.exclude(...).first()) — a page of 20 users
        # was 41 queries instead of 3. Both serializer methods now use these prefetches when present
        # (see role_codes() on the model and get_vendor() below) instead of re-querying per row.
        qs = (
            User.objects.all()
            .prefetch_related(
                "user_roles",
                Prefetch(
                    "vendors",
                    queryset=Vendor.objects.exclude(status=Vendor.STATUS_CLOSED_PERMANENTLY).only(
                        "handle", "shop_name", "owner_id"
                    ),
                ),
            )
            .order_by("-date_joined")
        )
        q = request.query_params
        if q.get("q"):
            term = q["q"].strip()
            qs = qs.filter(Q(name__icontains=term) | Q(phone__icontains=term))
        if q.get("role"):
            qs = qs.filter(user_roles__role_id=q["role"])
        if q.get("is_active") is not None and q.get("is_active") != "":
            qs = qs.filter(is_active=q["is_active"].lower() in ("1", "true", "yes"))
        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs.distinct(), request, view=self)
        return paginator.get_paginated_response(AdminUserListSerializer(page, many=True).data)


class AdminUserDetailView(APIView):
    permission_classes = [IsStaffRole]

    @extend_schema(responses=AdminUserDetailSerializer)
    def get(self, request, user_id):
        user = get_object_or_404(User, id=user_id)
        return Response(AdminUserDetailSerializer(user).data)


class AdminUserSuspendView(APIView):
    permission_classes = [admin_permission("accounts.manage_users")]

    @extend_schema(request=AdminUserSuspendSerializer, responses=AdminUserDetailSerializer)
    def post(self, request, user_id):
        user = get_object_or_404(User, id=user_id)
        if user.id == request.user.id:
            raise DomainError("You cannot suspend your own account.", code="cannot_suspend_self")
        s = AdminUserSuspendSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user.is_active = False
        user.suspended_at = timezone.now()
        user.suspension_reason = s.validated_data["reason"]
        user.save(update_fields=["is_active", "suspended_at", "suspension_reason", "updated_at"])
        audit.record("user.suspended", request=request, target=user, role="admin", reason=user.suspension_reason)
        return Response(AdminUserDetailSerializer(user).data)


class AdminUserRestoreView(APIView):
    permission_classes = [admin_permission("accounts.manage_users")]

    @extend_schema(request=None, responses=AdminUserDetailSerializer)
    def post(self, request, user_id):
        user = get_object_or_404(User, id=user_id)
        user.is_active = True
        user.suspended_at = None
        user.suspension_reason = ""
        user.save(update_fields=["is_active", "suspended_at", "suspension_reason", "updated_at"])
        audit.record("user.restored", request=request, target=user, role="admin")
        return Response(AdminUserDetailSerializer(user).data)
