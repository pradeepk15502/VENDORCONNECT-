from django.conf import settings
from django.db import IntegrityError
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.audit import service as audit
from vc.core.exceptions import DomainError
from vc.core.geo import make_point
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole, IsVendor
from vc.vendors.views import my_vendor

from .models import Category, InventoryEvent, PriceHistory, VendorProduct
from .search import SearchQuery, get_search_backend
from .serializers import (
    AdminCategorySerializer,
    AdminListingSerializer,
    CategorySerializer,
    InventoryUpdateSerializer,
    ListingDetailSerializer,
    PriceUpdateSerializer,
    SearchQuerySerializer,
    SearchResultSerializer,
    VendorProductCreateSerializer,
    VendorProductQuerySerializer,
    VendorProductSerializer,
    VendorProductUpdateSerializer,
)


class CategoryListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = CategorySerializer
    pagination_class = None
    queryset = Category.objects.filter(is_active=True).select_related("parent")


_SEARCH_PARAMETERS = [
    OpenApiParameter(
        "q",
        str,
        OpenApiParameter.QUERY,
        required=False,
        description="Free text: product name, alias, or Hindi. Blank = browse (use with `category`).",
    ),
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
        "in_stock_only", bool, OpenApiParameter.QUERY, required=False, description="Exclude out-of-stock listings."
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
    OpenApiParameter("price_min", float, OpenApiParameter.QUERY, required=False, description="Minimum listing price."),
    OpenApiParameter("price_max", float, OpenApiParameter.QUERY, required=False, description="Maximum listing price."),
    OpenApiParameter("page", int, OpenApiParameter.QUERY, required=False),
    OpenApiParameter("page_size", int, OpenApiParameter.QUERY, required=False),
]


class ListingDetailView(APIView):
    """GET /listings/{id} (Phase 9, ARCHITECTURE D30) — the standalone product-detail page a Post
    or Review's "View Product" link opens. Public, like the vendor profile's Products tab; a
    listing on a suspended/closed vendor, or one that's been deleted/paused, 404s rather than
    showing stale/unavailable data."""

    permission_classes = [AllowAny]

    @extend_schema(responses=ListingDetailSerializer)
    def get(self, request, pk):
        from vc.vendors.models import Vendor

        listing = get_object_or_404(
            VendorProduct.objects.filter(
                status=VendorProduct.STATUS_ACTIVE, vendor__status=Vendor.STATUS_ACTIVE
            ).select_related("category", "product", "vendor"),
            id=pk,
        )
        return Response(ListingDetailSerializer(listing).data)


class SearchView(APIView):
    """GET /search — product/vendor search, ranked per ARCHITECTURE D10. Public; no login required
    (customers can browse before signing in — D17)."""

    permission_classes = [AllowAny]

    @extend_schema(parameters=_SEARCH_PARAMETERS, responses=SearchResultSerializer(many=True))
    def get(self, request):
        params = SearchQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        v = params.validated_data

        query = SearchQuery(
            point=make_point(v["lat"], v["lng"]),
            radius_km=v.get("radius_km") or settings.SEARCH_RADIUS_KM_DEFAULT,
            q=v.get("q", ""),
            category_slug=v.get("category") or None,
            in_stock_only=v["in_stock_only"],
            open_now=v["open_now"],
            delivery=v["delivery"],
            pickup=v["pickup"],
            price_min=v.get("price_min"),
            price_max=v.get("price_max"),
        )
        results = get_search_backend().search(query)

        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(results, request, view=self)
        data = SearchResultSerializer(page, many=True).data
        return paginator.get_paginated_response(data)


# --- Vendor-facing product/inventory/price management (Phase 4) -----------------------------

_VENDOR_PRODUCT_LIST_PARAMETERS = [
    OpenApiParameter(
        "status",
        str,
        OpenApiParameter.QUERY,
        required=False,
        description="active | paused | deleted. Default: active + paused (everything currently listed).",
    ),
    OpenApiParameter("category", str, OpenApiParameter.QUERY, required=False, description="Category slug filter."),
    OpenApiParameter(
        "availability", str, OpenApiParameter.QUERY, required=False, description="in_stock | low_stock | out_of_stock."
    ),
    OpenApiParameter("page", int, OpenApiParameter.QUERY, required=False),
    OpenApiParameter("page_size", int, OpenApiParameter.QUERY, required=False),
]

_DEFAULT_LISTING_STATUSES = [VendorProduct.STATUS_ACTIVE, VendorProduct.STATUS_PAUSED]


def _my_listing_or_404(request, pk):
    vendor = my_vendor(request.user)
    return get_object_or_404(
        VendorProduct.objects.select_related("category", "product", "variety").exclude(
            status=VendorProduct.STATUS_DELETED
        ),
        pk=pk,
        vendor=vendor,
    )


class VendorProductCollectionView(APIView):
    """GET lists the signed-in vendor's own listings. POST creates one. Not to be confused with the
    public GET /search (customer-facing, geo-ranked across all vendors)."""

    permission_classes = [IsVendor]

    @extend_schema(parameters=_VENDOR_PRODUCT_LIST_PARAMETERS, responses=VendorProductSerializer(many=True))
    def get(self, request):
        vendor = my_vendor(request.user)
        params = VendorProductQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        v = params.validated_data

        qs = VendorProduct.objects.filter(vendor=vendor).select_related("category", "product", "variety")
        qs = qs.filter(status=v["status"]) if v.get("status") else qs.filter(status__in=_DEFAULT_LISTING_STATUSES)
        if v.get("category"):
            qs = qs.filter(category__slug=v["category"])
        if v.get("availability"):
            qs = qs.filter(availability=v["availability"])
        qs = qs.order_by("name")

        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        data = VendorProductSerializer(page, many=True).data
        return paginator.get_paginated_response(data)

    @extend_schema(request=VendorProductCreateSerializer, responses=VendorProductSerializer)
    def post(self, request):
        vendor = my_vendor(request.user)
        s = VendorProductCreateSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        try:
            listing = s.save(vendor=vendor)
        except IntegrityError as exc:
            raise DomainError(
                "You already have an active listing for this product, variety and unit.",
                code="duplicate_listing",
                status_code=409,
            ) from exc
        audit.record("vendor_product.created", request=request, target=listing, role="vendor", name=listing.name)
        return Response(VendorProductSerializer(listing).data, status=status.HTTP_201_CREATED)


class VendorProductDetailView(APIView):
    """A single listing owned by the signed-in vendor. DELETE is a soft delete (`status=deleted`) —
    PriceHistory/InventoryEvent rows are kept for the audit trail rather than cascaded away."""

    permission_classes = [IsVendor]

    @extend_schema(responses=VendorProductSerializer)
    def get(self, request, pk):
        return Response(VendorProductSerializer(_my_listing_or_404(request, pk)).data)

    @extend_schema(request=VendorProductUpdateSerializer, responses=VendorProductSerializer)
    def patch(self, request, pk):
        listing = _my_listing_or_404(request, pk)
        s = VendorProductUpdateSerializer(listing, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        audit.record("vendor_product.updated", request=request, target=listing, role="vendor")
        return Response(VendorProductSerializer(_my_listing_or_404(request, pk)).data)

    @extend_schema(responses=None)
    def delete(self, request, pk):
        listing = _my_listing_or_404(request, pk)
        listing.status = VendorProduct.STATUS_DELETED
        listing.save(update_fields=["status", "updated_at"])
        audit.record("vendor_product.deleted", request=request, target=listing, role="vendor")
        return Response(status=status.HTTP_204_NO_CONTENT)


class InventoryView(APIView):
    """POST /inventory — one-tap stock updates, the InventoryEvent audit trail's write path."""

    permission_classes = [IsVendor]

    @extend_schema(request=InventoryUpdateSerializer, responses=VendorProductSerializer)
    def post(self, request):
        vendor = my_vendor(request.user)
        s = InventoryUpdateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        listing = get_object_or_404(
            VendorProduct.objects.exclude(status=VendorProduct.STATUS_DELETED), pk=v["listing_id"], vendor=vendor
        )

        mutation_id = v.get("client_mutation_id") or ""
        if mutation_id and InventoryEvent.objects.filter(listing=listing, client_mutation_id=mutation_id).exists():
            return Response(VendorProductSerializer(listing).data)  # already applied — idempotent replay

        try:
            InventoryEvent.objects.create(
                listing=listing,
                availability=v["availability"],
                quantity=v.get("quantity"),
                occurred_at=timezone.now(),
                client_mutation_id=mutation_id,
                changed_by=request.user,
            )
        except IntegrityError:
            return Response(VendorProductSerializer(listing).data)  # concurrent duplicate submission

        listing.availability = v["availability"]
        if "quantity" in v:
            listing.quantity = v["quantity"]
        listing.stock_updated_at = timezone.now()
        listing.save(update_fields=["availability", "quantity", "stock_updated_at", "updated_at"])
        audit.record(
            "vendor_product.stock_updated",
            request=request,
            target=listing,
            role="vendor",
            availability=v["availability"],
        )
        return Response(VendorProductSerializer(listing).data)


class PriceView(APIView):
    """POST /prices — changes a listing's price, the PriceHistory audit trail's write path."""

    permission_classes = [IsVendor]

    @extend_schema(request=PriceUpdateSerializer, responses=VendorProductSerializer)
    def post(self, request):
        vendor = my_vendor(request.user)
        s = PriceUpdateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        listing = get_object_or_404(
            VendorProduct.objects.exclude(status=VendorProduct.STATUS_DELETED), pk=v["listing_id"], vendor=vendor
        )

        if listing.mrp is not None and v["price"] > listing.mrp:
            raise DomainError("Price cannot exceed MRP.", code="price_exceeds_mrp")

        if v["price"] != listing.price:
            PriceHistory.objects.create(listing=listing, price=v["price"], changed_by=request.user)
            listing.price = v["price"]
            listing.price_updated_at = timezone.now()
            listing.save(update_fields=["price", "price_updated_at", "updated_at"])
            audit.record(
                "vendor_product.price_updated", request=request, target=listing, role="vendor", price=str(v["price"])
            )

        return Response(VendorProductSerializer(listing).data)


# --- Admin: catalog visibility (Phase 11, ARCHITECTURE D32) ---------------------------------------

_ADMIN_LISTING_PARAMETERS = [
    OpenApiParameter("q", str, required=False, description="Search by listing name."),
    OpenApiParameter("category", str, required=False, description="Category slug filter."),
    OpenApiParameter("vendor", str, required=False, description="Vendor handle filter."),
    OpenApiParameter("status", str, required=False, description="active | paused | deleted."),
    OpenApiParameter("availability", str, required=False, description="in_stock | low_stock | out_of_stock."),
    OpenApiParameter("page", int, required=False),
    OpenApiParameter("page_size", int, required=False),
]


class AdminListingListView(APIView):
    """GET /admin/products — every vendor's listing, across the whole platform (master prompt §10).
    Read-only: admin staff identify duplicate/suspicious/inactive listings themselves by browsing
    and filtering; nothing here writes to a vendor's own price/stock (see `AdminListingSerializer`)."""

    permission_classes = [IsStaffRole]

    @extend_schema(parameters=_ADMIN_LISTING_PARAMETERS, responses=AdminListingSerializer(many=True))
    def get(self, request):
        qs = VendorProduct.objects.select_related("vendor", "category", "product").order_by("-created_at")
        q = request.query_params
        if q.get("q"):
            qs = qs.filter(name__icontains=q["q"].strip())
        if q.get("category"):
            qs = qs.filter(category__slug=q["category"])
        if q.get("vendor"):
            qs = qs.filter(vendor__handle__iexact=q["vendor"].lstrip("@"))
        if q.get("status"):
            qs = qs.filter(status=q["status"])
        else:
            qs = qs.exclude(status=VendorProduct.STATUS_DELETED)
        if q.get("availability"):
            qs = qs.filter(availability=q["availability"])
        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AdminListingSerializer(page, many=True).data)


class AdminCategoryListView(APIView):
    """GET /admin/categories — unlike the public `/categories`, includes inactive ones and real
    usage counts, so admin staff can spot an unused or duplicated taxonomy entry (master prompt
    §10). Read-only: category CRUD (merge/rename) is deferred — see docs/ARCHITECTURE.md D32."""

    permission_classes = [IsStaffRole]

    @extend_schema(responses=AdminCategorySerializer(many=True))
    def get(self, request):
        qs = Category.objects.annotate(
            product_count=Count("products", distinct=True),
            listing_count=Count("listings", filter=~Q(listings__status=VendorProduct.STATUS_DELETED), distinct=True),
            vendor_count=Count("vendors", distinct=True),
        ).order_by("sort_order", "name")
        return Response(AdminCategorySerializer(qs, many=True).data)
