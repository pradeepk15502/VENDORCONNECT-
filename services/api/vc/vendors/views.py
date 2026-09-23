from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.audit import service as audit
from vc.core.exceptions import DomainError
from vc.core.permissions import IsVendor

from .handles import normalize_handle
from .models import Vendor
from .serializers import (
    DeliverySerializer,
    ShopStatusSerializer,
    VendorCreateSerializer,
    VendorOwnerSerializer,
    VendorPublicSerializer,
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


class VendorCreateView(APIView):
    """Create my shop (vendor onboarding). Issues the unique Vendor ID."""

    permission_classes = [IsAuthenticated]

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


class VendorByHandleView(APIView):
    """GET /vendors/@SHARMA001 — case-insensitive, '@' optional. Public."""

    permission_classes = [AllowAny]

    @extend_schema(responses=VendorPublicSerializer)
    def get(self, request, handle):
        vendor = get_object_or_404(_public_qs(), handle__iexact=normalize_handle(handle))
        return Response(VendorPublicSerializer(vendor).data)
