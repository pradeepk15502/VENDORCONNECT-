from django.conf import settings
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.measure import D
from django.db import transaction
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.audit import service as audit
from vc.catalog.models import VendorProduct
from vc.catalog.serializers import VendorProductPublicSerializer
from vc.core.exceptions import DomainError
from vc.core.geo import make_point
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole, IsVendor, admin_permission

from .handles import normalize_handle
from .models import Vendor, VendorVerification
from .serializers import (
    AdminVendorDetailSerializer,
    AdminVendorListSerializer,
    AdminVendorSuspendSerializer,
    AdminVendorVerifyDecisionSerializer,
    DeliverySerializer,
    ShopStatusSerializer,
    VendorCreateSerializer,
    VendorListQuerySerializer,
    VendorListSerializer,
    VendorOwnerSerializer,
    VendorPublicSerializer,
    VendorSummarySerializer,
    VendorUpdateSerializer,
)


def _public_qs():
    return (
        Vendor.objects.filter(status=Vendor.STATUS_ACTIVE)
        .select_related("location", "delivery", "profile")
        .prefetch_related("categories")
    )


def my_vendor(user) -> Vendor:
    vendor = (
        Vendor.objects.filter(owner=user)
        .exclude(status=Vendor.STATUS_CLOSED_PERMANENTLY)
        .select_related("location", "delivery", "profile")
        .prefetch_related("categories")
        .first()
    )
    if vendor is None:
        raise DomainError("You have not created a shop yet.", code="no_shop", status_code=404)
    return vendor


_VENDOR_LIST_PARAMETERS = [
    OpenApiParameter(
        "lat",
        float,
        OpenApiParameter.QUERY,
        required=True,
        description="Customer's current latitude (sent per request, never stored — ARCHITECTURE D11).",
    ),
    OpenApiParameter("lng", float, OpenApiParameter.QUERY, required=True, description="Customer's current longitude."),
    OpenApiParameter("category", str, OpenApiParameter.QUERY, required=False, description="Category slug filter."),
    OpenApiParameter(
        "radius_km",
        float,
        OpenApiParameter.QUERY,
        required=False,
        description=f"Geo-filter radius (0.5–{settings.SEARCH_RADIUS_KM_MAX}). Default {settings.SEARCH_RADIUS_KM_DEFAULT}.",
    ),
    OpenApiParameter(
        "open_now", bool, OpenApiParameter.QUERY, required=False, description="Only vendors currently open."
    ),
    OpenApiParameter(
        "delivery", bool, OpenApiParameter.QUERY, required=False, description="Only vendors offering delivery."
    ),
    OpenApiParameter(
        "pickup", bool, OpenApiParameter.QUERY, required=False, description="Only vendors offering pickup."
    ),
    OpenApiParameter("page", int, OpenApiParameter.QUERY, required=False),
    OpenApiParameter("page_size", int, OpenApiParameter.QUERY, required=False),
]


class VendorCollectionView(APIView):
    """POST creates my shop (vendor onboarding, issues the unique Vendor ID). GET lists nearby
    vendors — public, no login required (customers can browse before signing in — D17)."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsAuthenticated()]

    @extend_schema(parameters=_VENDOR_LIST_PARAMETERS, responses=VendorListSerializer(many=True))
    def get(self, request):
        """GET /vendors — nearby vendor discovery (ARCHITECTURE D22). Open shops first, then
        nearest; optionally filtered to a category. Mirrors /search's geo-filter (D10) but ranks
        by open/distance only — there's no text query or product-relevance signal to weigh here."""
        params = VendorListQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        v = params.validated_data
        point = make_point(v["lat"], v["lng"])
        radius_km = v.get("radius_km") or settings.SEARCH_RADIUS_KM_DEFAULT

        qs = (
            _public_qs()
            .annotate(distance=Distance("location__point", point))
            .filter(location__point__distance_lte=(point, D(km=radius_km)))
        )
        if v.get("category"):
            qs = qs.filter(categories__slug=v["category"])
        if v["open_now"]:
            qs = qs.filter(is_open=True)
        if v["delivery"]:
            qs = qs.filter(delivery__delivery_enabled=True)
        if v["pickup"]:
            qs = qs.filter(delivery__pickup_enabled=True)
        qs = qs.order_by("-is_open", "distance")

        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        data = VendorListSerializer(page, many=True, context={"following_ids": _following_ids(request, page)}).data
        return paginator.get_paginated_response(data)

    @extend_schema(request=VendorCreateSerializer, responses=VendorOwnerSerializer)
    def post(self, request):
        if Vendor.objects.filter(owner=request.user).exclude(status=Vendor.STATUS_CLOSED_PERMANENTLY).exists():
            raise DomainError("You already have a shop.", code="shop_exists", status_code=409)
        s = VendorCreateSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        vendor = s.save()
        audit.record("vendor.created", request=request, target=vendor, role="vendor", handle=vendor.handle)
        vendor = my_vendor(request.user)
        return Response(VendorOwnerSerializer(vendor).data, status=status.HTTP_201_CREATED)


class MyVendorView(APIView):
    permission_classes = [IsVendor]

    @extend_schema(responses=VendorOwnerSerializer)
    def get(self, request):
        return Response(VendorOwnerSerializer(my_vendor(request.user)).data)

    @extend_schema(request=VendorUpdateSerializer, responses=VendorOwnerSerializer)
    def patch(self, request):
        vendor = my_vendor(request.user)
        s = VendorUpdateSerializer(vendor, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(VendorOwnerSerializer(my_vendor(request.user)).data)


class VendorSummaryView(APIView):
    """GET /vendors/me/summary — the dashboard's stat tiles, in one query (ARCHITECTURE D25)."""

    permission_classes = [IsVendor]

    @extend_schema(responses=VendorSummarySerializer)
    def get(self, request):
        vendor = my_vendor(request.user)
        counts = vendor.listings.filter(
            status__in=[VendorProduct.STATUS_ACTIVE, VendorProduct.STATUS_PAUSED]
        ).aggregate(
            product_count=Count("id"),
            low_stock_count=Count("id", filter=Q(availability=VendorProduct.AVAIL_LOW)),
            out_of_stock_count=Count("id", filter=Q(availability=VendorProduct.AVAIL_OUT)),
        )
        data = {"is_open": vendor.is_open, "status_changed_at": vendor.status_changed_at, **counts}
        return Response(VendorSummarySerializer(data).data)


class ShopStatusView(APIView):
    """One-tap open/close. Customers see the change on their next request."""

    permission_classes = [IsVendor]

    @extend_schema(request=ShopStatusSerializer, responses=ShopStatusSerializer)
    def post(self, request):
        vendor = my_vendor(request.user)
        s = ShopStatusSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(vendor)
        audit.record(
            "vendor.shop_opened" if vendor.is_open else "vendor.shop_closed",
            request=request,
            target=vendor,
            role="vendor",
        )
        return Response({"is_open": vendor.is_open, "status_changed_at": vendor.status_changed_at})


class DeliverySettingsView(APIView):
    permission_classes = [IsVendor]

    @extend_schema(request=DeliverySerializer, responses=DeliverySerializer)
    def patch(self, request):
        vendor = my_vendor(request.user)
        s = DeliverySerializer(vendor.delivery, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


def _following_ids(request, vendors) -> set:
    """One bulk query for a whole page of vendor cards (or a single vendor) — never one query per
    row (Phase 9, ARCHITECTURE D30; master prompt §46)."""
    if not request.user.is_authenticated:
        return set()
    from vc.social.models import Follow

    ids = [v.id for v in vendors] if not hasattr(vendors, "id") else [vendors.id]
    return set(Follow.objects.filter(user=request.user, vendor_id__in=ids).values_list("vendor_id", flat=True))


class VendorByHandleView(APIView):
    """GET /vendors/@SHARMA001 — case-insensitive, '@' optional. Public."""

    permission_classes = [AllowAny]

    @extend_schema(responses=VendorPublicSerializer)
    def get(self, request, handle):
        vendor = get_object_or_404(_public_qs(), handle__iexact=normalize_handle(handle))
        return Response(VendorPublicSerializer(vendor, context={"following_ids": _following_ids(request, vendor)}).data)


class VendorProductsPublicView(APIView):
    """GET /vendors/@SHARMA001/products — the profile's "Products" tab (Phase 8, ARCHITECTURE D29).
    Public, no geo-ranking needed (the vendor is already chosen); in-stock/low-stock listings sort
    ahead of out-of-stock ones, then alphabetically."""

    permission_classes = [AllowAny]

    @extend_schema(responses=VendorProductPublicSerializer(many=True))
    def get(self, request, handle):
        vendor = get_object_or_404(
            Vendor.objects.filter(status=Vendor.STATUS_ACTIVE), handle__iexact=normalize_handle(handle)
        )
        qs = (
            VendorProduct.objects.filter(vendor=vendor, status=VendorProduct.STATUS_ACTIVE)
            .select_related("category", "product")
            .annotate(
                _out=Case(
                    When(availability=VendorProduct.AVAIL_OUT, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                )
            )
            .order_by("_out", "name")
        )
        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(VendorProductPublicSerializer(page, many=True).data)


# --- Admin: vendor management + verification (Phase 11, ARCHITECTURE D32) ------------------------

_ADMIN_VENDOR_LIST_PARAMETERS = [
    OpenApiParameter("q", str, required=False, description="Search by shop name or Vendor ID (handle)."),
    OpenApiParameter("status", str, required=False, description="active | suspended | closed_permanently"),
    OpenApiParameter(
        "verification_status", str, required=False, description="unverified | pending | verified | rejected"
    ),
    OpenApiParameter("category", str, required=False, description="Category slug."),
    OpenApiParameter("page", int, required=False),
    OpenApiParameter("page_size", int, required=False),
]


def _admin_vendor_qs():
    return Vendor.objects.select_related("location", "delivery", "owner").prefetch_related("categories", "hours")


class AdminVendorListView(APIView):
    """GET /admin/vendors — any staff role may browse/search every vendor regardless of status
    (unlike the public `/vendors` list, which only ever shows `STATUS_ACTIVE` ones)."""

    permission_classes = [IsStaffRole]

    @extend_schema(parameters=_ADMIN_VENDOR_LIST_PARAMETERS, responses=AdminVendorListSerializer(many=True))
    def get(self, request):
        qs = _admin_vendor_qs().order_by("-created_at")
        q = request.query_params
        if q.get("q"):
            term = q["q"].strip().lstrip("@")
            qs = qs.filter(Q(shop_name__icontains=term) | Q(handle__icontains=term))
        if q.get("status"):
            qs = qs.filter(status=q["status"])
        if q.get("verification_status"):
            qs = qs.filter(verification_status=q["verification_status"])
        if q.get("category"):
            qs = qs.filter(categories__slug=q["category"])
        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs.distinct(), request, view=self)
        return paginator.get_paginated_response(AdminVendorListSerializer(page, many=True).data)


class AdminVendorDetailView(APIView):
    permission_classes = [IsStaffRole]

    @extend_schema(responses=AdminVendorDetailSerializer)
    def get(self, request, handle):
        vendor = get_object_or_404(_admin_vendor_qs(), handle__iexact=normalize_handle(handle))
        return Response(AdminVendorDetailSerializer(vendor).data)


class AdminVendorVerifyView(APIView):
    """POST /admin/vendors/{handle}/verify — records a real decision in `VendorVerification` (a
    Phase-0 schema table that existed but nothing wrote to before this) and updates the vendor's
    live `verification_status`. Reuses the `vendors.verify_vendor` Django permission already
    declared on `Vendor.Meta` since Phase 8/9 — no new permission needed."""

    permission_classes = [admin_permission("vendors.verify_vendor")]

    @extend_schema(request=AdminVendorVerifyDecisionSerializer, responses=AdminVendorDetailSerializer)
    def post(self, request, handle):
        vendor = get_object_or_404(_admin_vendor_qs(), handle__iexact=normalize_handle(handle))
        s = AdminVendorVerifyDecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        now = timezone.now()
        # Phase 12 hardening (docs/ARCHITECTURE.md D33): these two writes record one decision —
        # the audit-trail row and the vendor's live status must never disagree. Previously they were
        # two separate, unwrapped saves; if `vendor.save()` raised after the `VendorVerification` row
        # had already committed (a DB blip, a connection error), the decision would be recorded in
        # the audit trail but never reflected in `Vendor.verification_status` — an orphaned record
        # disagreeing with live vendor state, with no way to tell from the vendor's own row that a
        # decision was ever made.
        with transaction.atomic():
            VendorVerification.objects.create(
                vendor=vendor, decision=v["decision"], decided_by=request.user, decided_at=now, notes=v["notes"]
            )
            vendor.verification_status = v["decision"]
            vendor.verified_at = now if v["decision"] == Vendor.VERIFY_VERIFIED else None
            vendor.save(update_fields=["verification_status", "verified_at", "updated_at"])
        audit.record(f"vendor.{v['decision']}", request=request, target=vendor, role="admin", notes=v["notes"])
        return Response(AdminVendorDetailSerializer(vendor).data)


class AdminVendorSuspendView(APIView):
    permission_classes = [admin_permission("vendors.suspend_vendor")]

    @extend_schema(request=AdminVendorSuspendSerializer, responses=AdminVendorDetailSerializer)
    def post(self, request, handle):
        vendor = get_object_or_404(_admin_vendor_qs(), handle__iexact=normalize_handle(handle))
        s = AdminVendorSuspendSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        vendor.status = Vendor.STATUS_SUSPENDED
        vendor.status_changed_at = timezone.now()
        vendor.save(update_fields=["status", "status_changed_at", "updated_at"])
        audit.record(
            "vendor.suspended", request=request, target=vendor, role="admin", reason=s.validated_data["reason"]
        )
        return Response(AdminVendorDetailSerializer(vendor).data)


class AdminVendorRestoreView(APIView):
    permission_classes = [admin_permission("vendors.suspend_vendor")]

    @extend_schema(request=None, responses=AdminVendorDetailSerializer)
    def post(self, request, handle):
        vendor = get_object_or_404(_admin_vendor_qs(), handle__iexact=normalize_handle(handle))
        vendor.status = Vendor.STATUS_ACTIVE
        vendor.status_changed_at = timezone.now()
        vendor.save(update_fields=["status", "status_changed_at", "updated_at"])
        audit.record("vendor.restored", request=request, target=vendor, role="admin")
        return Response(AdminVendorDetailSerializer(vendor).data)
