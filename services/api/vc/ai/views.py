"""AI-assisted product entry (Phase 10). Two endpoints do the real work:

`POST /ai/detections`         — run a scan (barcode + OCR + taxonomy match) on an uploaded image.
`POST /ai/detections/{id}/confirm` — the vendor's edited, final answer; reuses the exact same
                                      `VendorProductCreateSerializer`/save path as manual "Add
                                      Product" (master prompt §18 — "do not create a separate
                                      AI-only product database").

Nothing here ever publishes a listing on its own — `confirm` is the *only* endpoint that writes a
`VendorProduct`, and only once the signed-in vendor calls it with their own (possibly edited)
values. Authorization is resolved from the authenticated session throughout (`my_vendor`); no
vendor/product/price value the client sends is ever trusted for ownership (master prompt §20).
"""

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from vc.assets.models import MediaAsset
from vc.audit import service as audit
from vc.catalog.models import VendorProduct
from vc.catalog.serializers import VendorProductCreateSerializer, VendorProductSerializer
from vc.core.exceptions import DomainError
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole, IsVendor
from vc.vendors.views import my_vendor

from .detection import run_detection
from .models import AIDetection
from .serializers import AIDetectionListItemSerializer, AIDetectionSerializer, AIDetectRequestSerializer


def _vendor_detection_or_404(vendor, pk) -> AIDetection:
    return get_object_or_404(
        AIDetection.objects.select_related("image", "model_version", "vendor", "vendor__location"),
        pk=pk,
        vendor=vendor,
    )


class AiDetectionThrottle(UserRateThrottle):
    """Phase 12 hardening: `run_detection` is synchronous, CPU-bound OCR + barcode inference (see
    `detection.py`'s own docstring) running inline in the request-handling worker — not a background
    job. Reaching this endpoint only requires `IsVendor`, and becoming a vendor is instant self-serve
    (one OTP signup + one `POST /vendors`), so the generic `user` throttle (sized for cheap CRUD) was
    the only thing standing between one account and hundreds of OCR/barcode passes per minute."""

    scope = "ai_detection"


class AIDetectionCreateView(APIView):
    """POST creates a scan; GET-like history lives at `/vendors/me/ai-detections` instead, so this
    stays a plain creation endpoint (mirrors `VendorProductCollectionView`'s split)."""

    permission_classes = [IsVendor]
    throttle_classes = [AiDetectionThrottle]

    @extend_schema(request=AIDetectRequestSerializer, responses=AIDetectionSerializer)
    def post(self, request):
        vendor = my_vendor(request.user)
        s = AIDetectRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        image = MediaAsset.objects.filter(pk=s.validated_data["image_id"], owner=request.user).first()
        if image is None:
            raise DomainError("Image not found.", code="image_not_found", status_code=404)
        if image.kind != MediaAsset.KIND_IMAGE:
            raise DomainError(
                "Only photos can be scanned — that upload isn't an image.",
                code="unsupported_media",
                status_code=400,
            )

        detection = run_detection(vendor=vendor, requested_by=request.user, image=image)
        audit.record(
            "ai_detection.created",
            request=request,
            target=detection,
            role="vendor",
            status=detection.status,
            has_predictions=bool(detection.predictions),
        )
        return Response(AIDetectionSerializer(detection).data, status=status.HTTP_201_CREATED)


class AIDetectionDetailView(APIView):
    permission_classes = [IsVendor]

    @extend_schema(responses=AIDetectionSerializer)
    def get(self, request, pk):
        vendor = my_vendor(request.user)
        detection = _vendor_detection_or_404(vendor, pk)
        return Response(AIDetectionSerializer(detection).data)


class AIDetectionConfirmView(APIView):
    """POST /ai/detections/{id}/confirm — the vendor's edited final values, in the exact same shape
    as manual `POST /vendor-products` (master prompt §17: "the final action must be explicit; the
    AI must never automatically publish")."""

    permission_classes = [IsVendor]

    @extend_schema(request=VendorProductCreateSerializer, responses=VendorProductSerializer)
    def post(self, request, pk):
        vendor = my_vendor(request.user)
        detection = _vendor_detection_or_404(vendor, pk)
        if detection.status not in (AIDetection.S_DONE, AIDetection.S_FAILED):
            raise DomainError(
                "This scan has already been used or discarded.", code="detection_already_used", status_code=409
            )

        s = VendorProductCreateSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        try:
            # A savepoint, not just a bare try/except: on the (expected) IntegrityError from the
            # `uniq_active_listing` constraint, this rolls back only this insert rather than
            # poisoning the whole request's transaction — the confirm view still needs to work
            # (e.g. re-reading `detection` below) after a duplicate is caught.
            with transaction.atomic():
                listing = s.save(vendor=vendor)
        except IntegrityError as exc:
            raise DomainError(
                "You already have an active listing for this product, variety and unit.",
                code="duplicate_listing",
                status_code=409,
            ) from exc

        listing.source = VendorProduct.SOURCE_AI
        listing.save(update_fields=["source"])

        top = detection.predictions[0] if detection.predictions else None
        corrected = (
            top is None
            or top.get("product_slug") != (listing.product.slug if listing.product_id else None)
            or (top.get("variety_id") != (str(listing.variety_id) if listing.variety_id else None))
        )
        detection.status = AIDetection.S_CONFIRMED
        detection.confirmed_listing = listing
        detection.vendor_corrected = corrected
        detection.save(update_fields=["status", "confirmed_listing", "vendor_corrected", "updated_at"])

        audit.record(
            "vendor_product.created", request=request, target=listing, role="vendor", name=listing.name, via="ai"
        )
        return Response(VendorProductSerializer(listing).data, status=status.HTTP_201_CREATED)


class AIDetectionHistoryView(APIView):
    """GET /vendors/me/ai-detections — the vendor's own scan history (master prompt §19). An audit
    trail, not a second product list: it never appears anywhere a customer can see."""

    permission_classes = [IsVendor]

    @extend_schema(responses=AIDetectionListItemSerializer(many=True))
    def get(self, request):
        vendor = my_vendor(request.user)
        qs = AIDetection.objects.filter(vendor=vendor).select_related("model_version", "vendor").order_by("-created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AIDetectionListItemSerializer(page, many=True).data)


class AdminAIDetectionListView(APIView):
    """GET /admin/ai/detections — minimal operational visibility (master prompt §25): detection
    volume, failures, which provider/model produced them. Deliberately not a second admin CRUD
    panel — read-only, same `IsStaffRole` bar as the Phase 9 report queue."""

    permission_classes = [IsStaffRole]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status", str, required=False, description="pending | done | failed | confirmed | discarded"
            ),
            OpenApiParameter("vendor", str, required=False, description="Vendor handle"),
        ],
        responses=AIDetectionListItemSerializer(many=True),
    )
    def get(self, request):
        qs = AIDetection.objects.select_related("model_version", "vendor").order_by("-created_at")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("vendor"):
            qs = qs.filter(vendor__handle__iexact=request.query_params["vendor"].lstrip("@"))
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AIDetectionListItemSerializer(page, many=True).data)
