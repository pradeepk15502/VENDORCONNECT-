from datetime import datetime, time, timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.timezone import is_naive, make_aware
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.accounts.models import User
from vc.ai.models import AIDetection
from vc.catalog.models import Product, VendorProduct
from vc.moderation.models import Report
from vc.orders.models import Order
from vc.social.models import Post, Review
from vc.vendors.models import Vendor

from .exceptions import DomainError
from .permissions import IsStaffRole
from .serializers import AdminDashboardSerializer


class AdminWhoAmIView(APIView):
    """Used by the admin web app to confirm an admin-grade session (password + OTP)."""

    permission_classes = [IsStaffRole]

    @extend_schema(
        responses=inline_serializer(
            "AdminWhoAmI",
            {
                "id": serializers.UUIDField(),
                "name": serializers.CharField(),
                "roles": serializers.ListField(child=serializers.CharField()),
                "permissions": serializers.ListField(child=serializers.CharField()),
            },
        )
    )
    def get(self, request):
        u = request.user
        return Response(
            {
                "id": str(u.id),
                "name": u.name,
                "roles": sorted(u.role_codes()),
                "permissions": sorted(u.get_all_permissions()) if not u.is_superuser else ["*"],
            }
        )


def _parse_boundary(value: str, *, end_of_day: bool) -> datetime | None:
    """Accepts either a full ISO datetime or a bare date (interpreted as that day's start/end)."""
    dt = parse_datetime(value)
    if dt is None:
        d = parse_date(value)
        if d is None:
            return None
        dt = datetime.combine(d, time.max if end_of_day else time.min)
    return make_aware(dt) if is_naive(dt) else dt


def _resolve_range(request) -> tuple[datetime, datetime, str]:
    """today | 7d | 30d | custom (master prompt §5: every metric states its own period)."""
    now = timezone.now()
    range_key = request.query_params.get("range", "7d")
    if range_key == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0), now, range_key
    if range_key == "30d":
        return now - timedelta(days=30), now, range_key
    if range_key == "custom":
        raw_from, raw_to = request.query_params.get("date_from"), request.query_params.get("date_to")
        start = _parse_boundary(raw_from, end_of_day=False) if raw_from else None
        end = _parse_boundary(raw_to, end_of_day=True) if raw_to else None
        if start is None or end is None:
            raise DomainError(
                "date_from and date_to (ISO date or datetime) are required for a custom range.",
                code="invalid_range",
            )
        return start, end, range_key
    return now - timedelta(days=7), now, "7d"  # default, and the fallback for an unrecognised range value


class AdminDashboardView(APIView):
    """GET /admin/dashboard — real, freshly-computed platform metrics (Phase 11 §4/§5). Every count
    is a live DB aggregate for the requested period; nothing here is cached, estimated or seeded —
    an empty platform genuinely shows zeroes, not placeholder numbers."""

    permission_classes = [IsStaffRole]

    @extend_schema(
        parameters=[
            OpenApiParameter("range", str, required=False, enum=["today", "7d", "30d", "custom"]),
            OpenApiParameter("date_from", str, required=False, description="Required when range=custom."),
            OpenApiParameter("date_to", str, required=False, description="Required when range=custom."),
        ],
        responses=AdminDashboardSerializer,
    )
    def get(self, request):
        start, end, range_key = _resolve_range(request)

        users = {
            "total": User.objects.count(),
            "new": User.objects.filter(date_joined__gte=start, date_joined__lte=end).count(),
            "active": User.objects.filter(last_login__gte=start, last_login__lte=end).count(),
        }
        vendors = {
            "total": Vendor.objects.count(),
            "pending_verification": Vendor.objects.filter(verification_status=Vendor.VERIFY_PENDING).count(),
            "active": Vendor.objects.filter(status=Vendor.STATUS_ACTIVE).count(),
            "suspended": Vendor.objects.filter(status=Vendor.STATUS_SUSPENDED).count(),
        }
        products = {
            "total": Product.objects.filter(is_active=True).count(),
            "active_listings": VendorProduct.objects.filter(status=VendorProduct.STATUS_ACTIVE).count(),
            "out_of_stock_listings": VendorProduct.objects.filter(
                status=VendorProduct.STATUS_ACTIVE, availability=VendorProduct.AVAIL_OUT
            ).count(),
        }
        orders_in_range = Order.objects.filter(created_at__gte=start, created_at__lte=end)
        orders_completed = orders_in_range.filter(status=Order.S_COMPLETED).count()
        orders_cancelled = orders_in_range.filter(status__in=[Order.S_CANCELLED, Order.S_REJECTED]).count()
        orders_total = orders_in_range.count()
        orders = {
            "total": orders_total,
            "pending": orders_total - orders_completed - orders_cancelled,
            "completed": orders_completed,
            "cancelled": orders_cancelled,
        }
        moderation = {
            "open_reports": Report.objects.filter(status__in=["open", "reviewing"]).count(),
            "reported_posts": Report.objects.filter(target_type="post", created_at__gte=start, created_at__lte=end)
            .values("target_id")
            .distinct()
            .count(),
            "reported_reviews": Report.objects.filter(target_type="review", created_at__gte=start, created_at__lte=end)
            .values("target_id")
            .distinct()
            .count(),
            "hidden_content": Post.objects.filter(status=Post.STATUS_HIDDEN).count()
            + Review.objects.filter(status=Review.STATUS_HIDDEN).count(),
        }
        ai_in_range = AIDetection.objects.filter(created_at__gte=start, created_at__lte=end)
        ai = {
            "detections": ai_in_range.count(),
            "failed_detections": ai_in_range.filter(status=AIDetection.S_FAILED).count(),
            "dev_scanner_usage": ai_in_range.filter(model_version__metrics__is_development=True).count(),
        }
        body = {
            "range": range_key,
            "period_start": start,
            "period_end": end,
            "users": users,
            "vendors": vendors,
            "products": products,
            "orders": orders,
            "moderation": moderation,
            "ai": ai,
        }
        return Response(AdminDashboardSerializer(body).data)
