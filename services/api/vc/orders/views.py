from decimal import Decimal

from django.conf import settings
from django.contrib.gis.db.models.functions import Distance as GeoDistance
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.accounts.models import Address
from vc.audit import service as audit
from vc.catalog.models import InventoryEvent, VendorProduct
from vc.core.exceptions import DomainError
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole
from vc.notifications import service as notifications
from vc.social import services as social_services
from vc.social.models import Review
from vc.social.serializers import ReviewCreateSerializer, ReviewSerializer
from vc.vendors.handles import normalize_handle
from vc.vendors.models import Vendor, VendorLocation
from vc.vendors.views import my_vendor

from . import transitions
from .models import Cart, CartItem, Order, OrderItem, OrderStatusEvent, Payment
from .numbers import create_order_with_number
from .payments import METHOD_CASH, METHOD_CHOICES, get_payment_provider
from .serializers import (
    AdminOrderListSerializer,
    CartAddSerializer,
    CartItemSerializer,
    CartUpdateSerializer,
    CheckoutSerializer,
    CheckoutSummaryQuerySerializer,
    CheckoutSummarySerializer,
    OrderListQuerySerializer,
    OrderSerializer,
    OrderTransitionSerializer,
)

ORDER_PREFETCH = ("items", "events", "payments", "reviews")

_DELIVERY_MESSAGES = {
    "delivery_disabled": "This vendor is pickup only.",
    "address_missing_location": "Add a location to this address to check delivery availability.",
    "outside_radius": "This vendor does not deliver to your location.",
    "below_minimum": "This order is below the vendor's minimum for delivery.",
}

# Real events only (master prompt's own list) — no notification for "preparing"/"picked_up", which
# it never asked for. {action: (kind, title)}; body is built with the order's own details.
_CUSTOMER_NOTIFY = {
    "accept": ("order_status", "Order accepted"),
    "reject": ("order_status", "Order rejected"),
    "ready": ("order_status", "Order ready"),
    "out_for_delivery": ("order_status", "Out for delivery"),
    "completed": ("order_status", "Order completed"),
}


# --- Cart ------------------------------------------------------------------------------------


def _cart_items_qs(user):
    return (
        CartItem.objects.filter(cart__customer=user)
        .select_related("listing", "listing__category", "vendor", "vendor__delivery")
        .order_by("vendor__shop_name", "created_at")
    )


class CartView(APIView):
    """A customer's own cart — a small, personal, unpaginated list (same shape as vendor quick
    replies). Vendor-aware: items carry their own vendor, grouped client-side (ARCHITECTURE D29)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=CartItemSerializer(many=True))
    def get(self, request):
        return Response(CartItemSerializer(_cart_items_qs(request.user), many=True).data)

    @extend_schema(request=CartAddSerializer, responses={200: CartItemSerializer, 201: CartItemSerializer})
    def post(self, request):
        v = CartAddSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        data = v.validated_data
        listing = get_object_or_404(
            VendorProduct.objects.select_related("vendor").filter(
                status=VendorProduct.STATUS_ACTIVE, vendor__status=Vendor.STATUS_ACTIVE
            ),
            id=data["listing_id"],
        )
        if listing.vendor.owner_id == request.user.id:
            raise DomainError("You can't order from your own shop.", code="cannot_order_own_shop")

        cart, _ = Cart.objects.get_or_create(customer=request.user)
        item, created = CartItem.objects.get_or_create(
            cart=cart,
            listing=listing,
            defaults={"vendor": listing.vendor, "quantity": data["quantity"], "note": data["note"]},
        )
        if not created:
            item.quantity += data["quantity"]
            if data["note"]:
                item.note = data["note"]
            item.save(update_fields=["quantity", "note", "updated_at"])
        item = _cart_items_qs(request.user).get(id=item.id)
        return Response(
            CartItemSerializer(item).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )


class CartItemDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, item_id):
        # Cross-account safety: scoped to the caller's own cart (master-prompt §68).
        return get_object_or_404(CartItem, id=item_id, cart__customer=request.user)

    @extend_schema(request=CartUpdateSerializer, responses=CartItemSerializer)
    def patch(self, request, item_id):
        item = self._get(request, item_id)
        v = CartUpdateSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        item.quantity = v.validated_data["quantity"]
        if "note" in v.validated_data:
            item.note = v.validated_data["note"]
        item.save(update_fields=["quantity", "note", "updated_at"])
        return Response(CartItemSerializer(_cart_items_qs(request.user).get(id=item.id)).data)

    @extend_schema(responses={204: None})
    def delete(self, request, item_id):
        self._get(request, item_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Checkout: shared context builder --------------------------------------------------------


def _resolve_vendor(handle):
    return get_object_or_404(
        Vendor.objects.select_related("delivery", "location"), handle__iexact=normalize_handle(handle)
    )


def build_checkout_context(user, vendor: Vendor, fulfilment: str, address: Address | None) -> dict:
    """The one place cart→order numbers are computed. `GET /checkout/summary` and `POST /checkout`
    both call this, so what a customer reviews is exactly what's checked at commit time
    (ARCHITECTURE D29) — there is no second, slightly-different code path to drift out of sync."""
    cart_items = list(CartItem.objects.filter(cart__customer=user, vendor=vendor).select_related("listing"))

    items = []
    subtotal = Decimal("0")
    for ci in cart_items:
        listing = ci.listing
        problem = None
        if listing.status != VendorProduct.STATUS_ACTIVE:
            problem = "listing_removed"
        elif listing.availability == VendorProduct.AVAIL_OUT:
            problem = "out_of_stock"
        elif listing.quantity is not None and listing.quantity < ci.quantity:
            problem = "insufficient_stock"
        line_total = listing.price * ci.quantity
        if problem is None:
            subtotal += line_total
        items.append(
            {
                "listing_id": listing.id,
                "name": listing.name,
                "unit": listing.unit,
                "unit_quantity": listing.unit_quantity,
                "price": listing.price,
                "availability": listing.availability,
                "quantity": ci.quantity,
                "line_total": line_total,
                "problem": problem,
            }
        )

    pickup_available = vendor.delivery.pickup_enabled
    delivery_available = vendor.delivery.delivery_enabled
    distance_km = None
    delivery_eligible = None
    delivery_ineligible_reason = None
    delivery_fee = Decimal("0")

    if fulfilment == Order.DELIVERY:
        if not delivery_available:
            delivery_eligible, delivery_ineligible_reason = False, "delivery_disabled"
        elif address is None or address.location is None:
            delivery_eligible, delivery_ineligible_reason = False, "address_missing_location"
        else:
            loc = VendorLocation.objects.annotate(distance=GeoDistance("point", address.location)).get(vendor=vendor)
            distance_km = round(loc.distance.km, 2)
            if distance_km > float(vendor.delivery.radius_km):
                delivery_eligible, delivery_ineligible_reason = False, "outside_radius"
            elif subtotal < vendor.delivery.min_order_amount:
                delivery_eligible, delivery_ineligible_reason = False, "below_minimum"
            else:
                delivery_eligible = True
                free_above = vendor.delivery.free_delivery_above
                delivery_fee = (
                    Decimal("0")
                    if (free_above is not None and subtotal >= free_above)
                    else vendor.delivery.delivery_fee
                )

    vendor_ok = vendor.status == Vendor.STATUS_ACTIVE and vendor.is_open
    no_problems = bool(items) and all(i["problem"] is None for i in items)
    fulfilment_ok = pickup_available if fulfilment == Order.PICKUP else bool(delivery_eligible)

    return {
        "vendor": vendor,
        "items": items,
        "subtotal": subtotal,
        "fulfilment": fulfilment,
        "pickup_available": pickup_available,
        "delivery_available": delivery_available,
        "address": address,
        "distance_km": distance_km,
        "delivery_eligible": delivery_eligible,
        "delivery_ineligible_reason": delivery_ineligible_reason,
        "delivery_fee": delivery_fee,
        "total": subtotal + delivery_fee,
        "can_place_order": vendor_ok and no_problems and fulfilment_ok,
        "payment_methods": [METHOD_CASH] if settings.ENVIRONMENT == "production" else list(METHOD_CHOICES),
    }


class CheckoutSummaryView(APIView):
    """Powers the Pickup/Delivery selection, Address selection and Order Review screens — the same
    numbers, recomputed live every time any of those three choices changes."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("vendor", str, required=True),
            OpenApiParameter("fulfilment", str, enum=["pickup", "delivery"], required=True),
            OpenApiParameter("address_id", str, required=False),
        ],
        responses=CheckoutSummarySerializer,
    )
    def get(self, request):
        v = CheckoutSummaryQuerySerializer(data=request.query_params)
        v.is_valid(raise_exception=True)
        data = v.validated_data
        vendor = _resolve_vendor(data["vendor"])
        address = None
        if data.get("address_id"):
            address = get_object_or_404(Address, id=data["address_id"], user=request.user)
        ctx = build_checkout_context(request.user, vendor, data["fulfilment"], address)
        return Response(CheckoutSummarySerializer(ctx).data)


def _diff_expected(current_items: list[dict], expected_items: list[dict]) -> list[dict]:
    """What changed between the client's last-seen snapshot and the truth right now — exactly what
    the checkout screen renders as "here's what changed" (ARCHITECTURE D29)."""
    current = {str(i["listing_id"]): i for i in current_items if i["problem"] is None}
    expected = {str(e["listing_id"]): e for e in expected_items}
    changes = []
    for lid, cur in current.items():
        exp = expected.get(lid)
        if exp is None:
            changes.append(
                {"listing_id": lid, "name": cur["name"], "field": "added_elsewhere", "old": None, "new": "in_cart"}
            )
            continue
        if cur["price"] != exp["price"]:
            changes.append(
                {
                    "listing_id": lid,
                    "name": cur["name"],
                    "field": "price",
                    "old": str(exp["price"]),
                    "new": str(cur["price"]),
                }
            )
        if cur["availability"] != exp["availability"]:
            changes.append(
                {
                    "listing_id": lid,
                    "name": cur["name"],
                    "field": "availability",
                    "old": exp["availability"],
                    "new": cur["availability"],
                }
            )
    for lid in expected:
        if lid not in current:
            changes.append({"listing_id": lid, "name": None, "field": "removed", "old": "in_cart", "new": None})
    return changes


def _address_snapshot(address: Address) -> dict:
    return {
        "label": address.label,
        "line1": address.line1,
        "line2": address.line2,
        "landmark": address.landmark,
        "city": address.city,
        "state": address.state,
        "pincode": address.pincode,
        "lat": address.location.y if address.location else None,
        "lng": address.location.x if address.location else None,
    }


class CheckoutView(APIView):
    """Atomic order creation. Re-derives everything from `build_checkout_context` *inside* the
    transaction, with the vendor's cart-referenced listings row-locked, so a vendor edit racing this
    request either lands before (and gets caught by the revalidation) or waits until after (and the
    next checkout attempt sees it) — never in between."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=CheckoutSerializer, responses={200: OrderSerializer, 201: OrderSerializer})
    def post(self, request):
        v = CheckoutSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        data = v.validated_data

        # Idempotent replay: a retry (network failure, double-tap) with the same key returns the
        # order already created for it instead of creating a second one.
        existing = Order.objects.filter(customer=request.user, idempotency_key=data["idempotency_key"]).first()
        if existing is not None:
            existing = (
                Order.objects.select_related("vendor", "customer").prefetch_related(*ORDER_PREFETCH).get(id=existing.id)
            )
            _attach_order_extras(existing, "customer")
            return Response(OrderSerializer(existing).data, status=status.HTTP_200_OK)

        vendor = _resolve_vendor(data["vendor"])
        if vendor.owner_id == request.user.id:
            raise DomainError("You can't order from your own shop.", code="cannot_order_own_shop")
        if data["payment_method"] != METHOD_CASH and settings.ENVIRONMENT == "production":
            raise DomainError(
                "Online payments aren't available yet. Please choose Cash.",
                code="payment_provider_unavailable",
                status_code=503,
            )

        address = None
        if data["fulfilment"] == Order.DELIVERY:
            address = get_object_or_404(Address, id=data["address_id"], user=request.user)

        with transaction.atomic():
            listing_ids = list(
                CartItem.objects.filter(cart__customer=request.user, vendor=vendor).values_list("listing_id", flat=True)
            )
            # Locked while we re-check *and* held through the stock consumption below (Phase 12
            # hardening — docs/ARCHITECTURE.md D33). Previously this only locked long enough to
            # re-validate `listing.quantity >= requested`, but never consumed the quantity it just
            # checked — so two concurrent (or even just sequential-but-fast) checkouts against a
            # quantity=1 listing could both pass the same insufficient_stock check and both succeed.
            # Holding the lock across the read-then-write closes that: a second checkout blocks here
            # until the first commits, and then sees the already-decremented value.
            locked_listings = {
                row.id: row for row in VendorProduct.objects.select_for_update().filter(id__in=listing_ids)
            }

            # select_for_update can't be combined with select_related's outer joins here (Postgres
            # refuses "FOR UPDATE" on the nullable side of a LEFT JOIN) — lock the row bare, then
            # read it back with the joins we actually need.
            Vendor.objects.select_for_update().get(id=vendor.id)
            vendor = Vendor.objects.select_related("delivery", "location").get(id=vendor.id)
            if vendor.status != Vendor.STATUS_ACTIVE:
                raise DomainError("This shop is no longer available.", code="vendor_unavailable", status_code=409)
            if not vendor.is_open:
                raise DomainError(
                    "This shop is currently closed. Try again once it reopens.", code="vendor_closed", status_code=409
                )

            ctx = build_checkout_context(request.user, vendor, data["fulfilment"], address)
            if not ctx["items"]:
                raise DomainError("Your cart for this shop is empty.", code="cart_empty", status_code=409)

            if any(i["problem"] for i in ctx["items"]):
                raise DomainError(
                    "Some items in your cart are no longer available.",
                    code="items_unavailable",
                    status_code=409,
                    details={"summary": CheckoutSummarySerializer(ctx).data},
                )

            if data["fulfilment"] == Order.PICKUP and not ctx["pickup_available"]:
                raise DomainError("This vendor doesn't offer pickup.", code="pickup_unavailable", status_code=409)
            if data["fulfilment"] == Order.DELIVERY and not ctx["delivery_eligible"]:
                raise DomainError(
                    _DELIVERY_MESSAGES.get(
                        ctx["delivery_ineligible_reason"], "Delivery isn't available for this order."
                    ),
                    code="delivery_ineligible",
                    status_code=409,
                    details={
                        "reason": ctx["delivery_ineligible_reason"],
                        "summary": CheckoutSummarySerializer(ctx).data,
                    },
                )

            changes = _diff_expected(ctx["items"], data["expected_items"])
            if changes:
                raise DomainError(
                    "Some items changed since you last checked. Please review and confirm.",
                    code="cart_changed",
                    status_code=409,
                    details={"changes": changes, "summary": CheckoutSummarySerializer(ctx).data},
                )

            order = create_order_with_number(
                customer=request.user,
                vendor=vendor,
                fulfilment=data["fulfilment"],
                status=Order.S_PLACED,
                delivery_address=_address_snapshot(address) if address else None,
                customer_note=data["customer_note"],
                subtotal=ctx["subtotal"],
                delivery_fee=ctx["delivery_fee"],
                total=ctx["total"],
                payment_method=data["payment_method"],
                idempotency_key=data["idempotency_key"],
            )
            OrderItem.objects.bulk_create(
                OrderItem(
                    order=order,
                    listing_id=i["listing_id"],
                    name=i["name"],
                    unit=i["unit"],
                    unit_price=i["price"],
                    quantity=i["quantity"],
                    line_total=i["line_total"],
                )
                for i in ctx["items"]
            )
            OrderStatusEvent.objects.create(order=order, status=Order.S_PLACED, actor=request.user)

            # Consume tracked stock now that the order is committed to (Phase 12 hardening — see the
            # note above). Only listings where the vendor actually tracks a count are touched;
            # `quantity=None` means the vendor doesn't track stock this way (availability alone is
            # their signal) and nothing here changes for them. The row is still lock-held from above,
            # so this can't race a second checkout for the same listing.
            for i in ctx["items"]:
                listing = locked_listings.get(i["listing_id"])
                if listing is not None and listing.quantity is not None:
                    listing.quantity = listing.quantity - i["quantity"]
                    listing.stock_updated_at = timezone.now()
                    listing.save(update_fields=["quantity", "stock_updated_at", "updated_at"])
                    InventoryEvent.objects.get_or_create(
                        listing=listing,
                        # Unique per (listing, client_mutation_id) — the order id alone is already
                        # unique per listing without needing the listing id folded in too (keeps
                        # this comfortably under the field's 64-char limit).
                        client_mutation_id=f"order:{order.id}",
                        defaults={
                            "availability": listing.availability,
                            "quantity": listing.quantity,
                            "occurred_at": timezone.now(),
                            "changed_by": None,
                        },
                    )

            provider = get_payment_provider()
            result = provider.charge(
                order=order, method=data["payment_method"], simulate_failure=data["simulate_failure"]
            )
            Payment.objects.create(
                order=order,
                method=data["payment_method"],
                provider=result.provider,
                provider_ref=result.provider_ref,
                amount=ctx["total"],
                status=result.status,
            )
            if not result.ok:
                raise DomainError(result.message or "Payment failed.", code="payment_failed", status_code=402)

            CartItem.objects.filter(cart__customer=request.user, vendor=vendor).delete()

        notifications.notify(
            vendor.owner,
            kind="new_order",
            title="New order",
            body=f"New order {order.number} — {len(ctx['items'])} item(s), ₹{ctx['total']}.",
            data={"order_id": str(order.id)},
        )
        audit.record(
            "order.placed", request=request, target=order, role="customer", vendor=vendor.handle, total=str(order.total)
        )

        order = Order.objects.select_related("vendor", "customer").prefetch_related(*ORDER_PREFETCH).get(id=order.id)
        _attach_order_extras(order, "customer")
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)


# --- Orders ----------------------------------------------------------------------------------


def _get_order(order_id, user) -> tuple[Order, str]:
    """A user is on one side of an order only, never both — resolve which, or 403 (master-prompt
    §68: no cross-account access, ever, regardless of what's guessed in a URL). Mirrors chat's
    `_get_chat`."""
    order = get_object_or_404(
        Order.objects.select_related("vendor", "customer").prefetch_related(*ORDER_PREFETCH), id=order_id
    )
    if order.customer_id == user.id:
        return order, "customer"
    if order.vendor.owner_id == user.id:
        return order, "vendor"
    raise PermissionDenied("You don't have access to this order.")


def _attach_order_extras(order: Order, role: str) -> Order:
    for event in order.events.all():
        if event.actor_id is None:
            event.actor_side = "system"
        elif event.actor_id == order.customer_id:
            event.actor_side = "customer"
        else:
            event.actor_side = "vendor"
    return order


class OrderCollectionView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("role", str, enum=["customer", "vendor"], required=True),
            OpenApiParameter("status", str, required=False),
            OpenApiParameter("page", int, required=False),
            OpenApiParameter("page_size", int, required=False),
        ],
        responses=OrderSerializer(many=True),
    )
    def get(self, request):
        v = OrderListQuerySerializer(data=request.query_params)
        v.is_valid(raise_exception=True)
        data = v.validated_data

        if data["role"] == "customer":
            qs, role = Order.objects.filter(customer=request.user), "customer"
        else:
            qs, role = Order.objects.filter(vendor=my_vendor(request.user)), "vendor"
        if data.get("status"):
            qs = qs.filter(status=data["status"])
        qs = qs.select_related("vendor", "customer").prefetch_related(*ORDER_PREFETCH).order_by("-created_at")

        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        for order in page:
            _attach_order_extras(order, role)
        return paginator.get_paginated_response(OrderSerializer(page, many=True).data)


class OrderDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OrderSerializer)
    def get(self, request, order_id):
        order, role = _get_order(order_id, request.user)
        _attach_order_extras(order, role)
        return Response(OrderSerializer(order).data)


def _settle_payment(order: Order, action: str):
    payment = order.payments.order_by("-created_at").first()
    if payment is None:
        return
    if action == "completed" and payment.status == "pending":
        payment.status = "succeeded"
        payment.save(update_fields=["status", "updated_at"])
    elif action in ("reject", "cancel"):
        if payment.status == "succeeded":
            result = get_payment_provider().refund(payment)
            payment.status = result.status
            payment.save(update_fields=["status", "updated_at"])
        elif payment.status == "pending":
            payment.status = "failed"  # cash never collected
            payment.save(update_fields=["status", "updated_at"])


def _notify_transition(order: Order, action: str, role: str):
    if role == "vendor" and action in _CUSTOMER_NOTIFY:
        kind, title = _CUSTOMER_NOTIFY[action]
        body = f"{order.vendor.shop_name}: order {order.number} — {title.lower()}."
        if action == "reject" and order.rejection_reason:
            body += f" Reason: {order.rejection_reason}"
        notifications.notify(order.customer, kind=kind, title=title, body=body, data={"order_id": str(order.id)})
    elif role == "customer" and action == "cancel":
        notifications.notify(
            order.vendor.owner,
            kind="order_status",
            title="Order cancelled",
            body=f"{order.customer.name or 'A customer'} cancelled order {order.number}.",
            data={"order_id": str(order.id)},
        )


class OrderTransitionView(APIView):
    """One endpoint, one table (`vc.orders.transitions`) — see ARCHITECTURE D29 for why this replaces
    eight near-duplicate accept/reject/preparing/... endpoints."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=OrderTransitionSerializer, responses=OrderSerializer)
    def post(self, request, order_id):
        with transaction.atomic():
            order = get_object_or_404(
                Order.objects.select_for_update().select_related("vendor", "customer"), id=order_id
            )
            if order.customer_id == request.user.id:
                role = "customer"
            elif order.vendor.owner_id == request.user.id:
                role = "vendor"
            else:
                raise PermissionDenied("You don't have access to this order.")

            v = OrderTransitionSerializer(data=request.data)
            v.is_valid(raise_exception=True)
            action, reason = v.validated_data["action"], v.validated_data.get("reason", "")

            try:
                rule = transitions.check(order, action, role)
            except transitions.InvalidTransition as exc:
                raise DomainError(exc.message, code=exc.code, status_code=409) from exc

            order.status = rule.to
            update_fields = ["status", "updated_at"]
            if action == "reject":
                order.rejection_reason = reason
                update_fields.append("rejection_reason")
            order.save(update_fields=update_fields)
            OrderStatusEvent.objects.create(order=order, status=rule.to, actor=request.user, note=reason)
            _settle_payment(order, action)

        _notify_transition(order, action, role)
        audit.record(f"order.{action}", request=request, target=order, role=role, status=rule.to)

        order = Order.objects.select_related("vendor", "customer").prefetch_related(*ORDER_PREFETCH).get(id=order.id)
        _attach_order_extras(order, role)
        return Response(OrderSerializer(order).data)


class OrderReviewView(APIView):
    """POST /orders/{id}/reviews (Phase 9, ARCHITECTURE D30) — the only way to create a review in
    this app: always for a specific completed order, never a bare vendor handle (master prompt
    §17: "reviews must be tied to genuine completed transactions"). Eligibility is resolved the
    same way every other order endpoint resolves identity — from the authenticated session, never
    a client-supplied vendor/order id pairing — and re-checked at the database via `uniq_review_per_order`."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=ReviewCreateSerializer, responses={201: ReviewSerializer})
    def post(self, request, order_id):
        order, role = _get_order(order_id, request.user)
        if role != "customer":
            raise PermissionDenied("Only the customer on this order can review it.")
        if order.status != Order.S_COMPLETED:
            raise DomainError("You can review an order once it's completed.", code="order_not_completed")
        if Review.objects.filter(order=order).exists():
            raise DomainError("You've already reviewed this order.", code="already_reviewed", status_code=409)

        s = ReviewCreateSerializer(data=request.data, context={"order": order})
        s.is_valid(raise_exception=True)
        v = s.validated_data

        try:
            with transaction.atomic():
                review = Review.objects.create(
                    vendor=order.vendor,
                    author=request.user,
                    order=order,
                    listing_id=v.get("listing_id"),
                    rating=v["rating"],
                    text=v.get("text", "").strip(),
                )
                social_services.recompute_vendor_rating(order.vendor_id)
        except IntegrityError as exc:
            # A second request for the same order raced past the pre-check above — `uniq_review_per_order`
            # is the real guarantee (master prompt §5-style "safe concurrent" requirement, applied to reviews).
            raise DomainError("You've already reviewed this order.", code="already_reviewed", status_code=409) from exc

        notifications.notify(
            order.vendor.owner,
            kind="new_review",
            title="You received a new review",
            body=f"{request.user.name or 'A customer'} rated {order.vendor.shop_name} {review.rating}★.",
            data={"order_id": str(order.id), "review_id": str(review.id)},
        )
        notifications.notify(
            request.user,
            kind="review_posted",
            title="Your review was posted",
            body=f"Thanks for reviewing {order.vendor.shop_name}.",
            data={"review_id": str(review.id), "vendor_handle": order.vendor.handle},
        )
        audit.record("review.created", request=request, target=review, role="customer")
        return Response(ReviewSerializer(review).data, status=status.HTTP_201_CREATED)


# --- Admin: order visibility (Phase 11, ARCHITECTURE D32) -----------------------------------------

_ADMIN_ORDER_LIST_PARAMETERS = [
    OpenApiParameter("q", str, required=False, description="Search by order number, customer name or vendor handle."),
    OpenApiParameter("status", str, required=False),
    OpenApiParameter("fulfilment", str, required=False, description="pickup | delivery"),
    OpenApiParameter("page", int, required=False),
    OpenApiParameter("page_size", int, required=False),
]


class AdminOrderListView(APIView):
    """GET /admin/orders — read-only cross-vendor/cross-customer visibility (master prompt §23).
    No refund/payment action lives here; `_settle_payment` (checkout/transition) is unchanged."""

    permission_classes = [IsStaffRole]

    @extend_schema(parameters=_ADMIN_ORDER_LIST_PARAMETERS, responses=AdminOrderListSerializer(many=True))
    def get(self, request):
        qs = Order.objects.select_related("customer", "vendor").prefetch_related("payments").order_by("-created_at")
        q = request.query_params
        if q.get("q"):
            term = q["q"].strip().lstrip("@")
            qs = qs.filter(
                Q(number__icontains=term) | Q(customer__name__icontains=term) | Q(vendor__handle__iexact=term)
            )
        if q.get("status"):
            qs = qs.filter(status=q["status"])
        if q.get("fulfilment"):
            qs = qs.filter(fulfilment=q["fulfilment"])
        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AdminOrderListSerializer(page, many=True).data)


class AdminOrderDetailView(APIView):
    """Reuses the same `OrderSerializer` both customer and vendor sides already see — deliberately
    (master prompt §24: "minimize exposed personal information"); it already omits the customer's
    phone number (see `_OrderCustomerRefSerializer`), which an admin support view doesn't need
    either to answer "what happened to this order"."""

    permission_classes = [IsStaffRole]

    @extend_schema(responses=OrderSerializer)
    def get(self, request, order_id):
        order = get_object_or_404(
            Order.objects.select_related("vendor", "customer").prefetch_related(*ORDER_PREFETCH), id=order_id
        )
        for event in order.events.all():
            event.actor_side = (
                "system" if event.actor_id is None else "customer" if event.actor_id == order.customer_id else "vendor"
            )
        return Response(OrderSerializer(order).data)
