from decimal import Decimal

from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from vc.accounts.serializers import AddressSerializer
from vc.vendors.serializers import DeliverySerializer

from . import transitions
from .models import Order, OrderItem
from .payments import METHOD_CHOICES

# --- Cart ------------------------------------------------------------------------------------


class CartAddSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal("0.01"), default=Decimal(1))
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class CartUpdateSerializer(serializers.Serializer):
    quantity = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal("0.01"))
    note = serializers.CharField(max_length=200, required=False, allow_blank=True)


class _CartVendorSerializer(serializers.Serializer):
    """A cart row's vendor group header — enough to render the group and gate its checkout button
    (closed shop, pickup/delivery availability) without a second request per vendor."""

    handle = serializers.CharField()
    vendor_id = serializers.CharField(source="display_handle")
    shop_name = serializers.CharField()
    status = serializers.CharField()
    is_open = serializers.BooleanField()
    delivery = DeliverySerializer()


class CartItemSerializer(serializers.Serializer):
    """One cart row. Price/availability are always read live off the listing (never cached on the
    cart item) — ARCHITECTURE D29: the cart can never show a stale number by construction, since
    there is nowhere for a stale one to be stored."""

    id = serializers.UUIDField()
    listing_id = serializers.UUIDField(source="listing.id")
    listing_status = serializers.CharField(source="listing.status")
    name = serializers.CharField(source="listing.name")
    unit = serializers.CharField(source="listing.unit")
    unit_quantity = serializers.DecimalField(source="listing.unit_quantity", max_digits=8, decimal_places=2)
    price = serializers.DecimalField(source="listing.price", max_digits=10, decimal_places=2)
    mrp = serializers.DecimalField(source="listing.mrp", max_digits=10, decimal_places=2, allow_null=True)
    availability = serializers.CharField(source="listing.availability")
    vendor = _CartVendorSerializer()
    quantity = serializers.DecimalField(max_digits=8, decimal_places=2)
    note = serializers.CharField()
    line_total = serializers.SerializerMethodField()
    added_at = serializers.DateTimeField(source="created_at")

    @extend_schema_field(serializers.DecimalField(max_digits=10, decimal_places=2))
    def get_line_total(self, item) -> Decimal:
        return item.listing.price * item.quantity


# --- Checkout summary (also powers pickup/delivery + address selection screens) ----------------


class CheckoutSummaryQuerySerializer(serializers.Serializer):
    vendor = serializers.CharField(help_text="Vendor handle, e.g. SHARMA001")
    fulfilment = serializers.ChoiceField(choices=[Order.PICKUP, Order.DELIVERY])
    address_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if attrs["fulfilment"] == Order.DELIVERY and not attrs.get("address_id"):
            raise serializers.ValidationError({"address_id": "Required when fulfilment is delivery."})
        return attrs


class CheckoutItemSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    name = serializers.CharField()
    unit = serializers.CharField()
    unit_quantity = serializers.DecimalField(max_digits=8, decimal_places=2)
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    availability = serializers.CharField()
    quantity = serializers.DecimalField(max_digits=8, decimal_places=2)
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2)
    problem = serializers.ChoiceField(
        choices=["out_of_stock", "insufficient_stock", "listing_removed"], allow_null=True
    )


class CheckoutSummarySerializer(serializers.Serializer):
    vendor = _CartVendorSerializer()
    items = CheckoutItemSerializer(many=True)
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2)
    fulfilment = serializers.CharField()
    pickup_available = serializers.BooleanField()
    delivery_available = serializers.BooleanField()
    address = AddressSerializer(allow_null=True)
    distance_km = serializers.FloatField(allow_null=True)
    delivery_eligible = serializers.BooleanField(allow_null=True)
    delivery_ineligible_reason = serializers.CharField(allow_null=True)
    delivery_fee = serializers.DecimalField(max_digits=8, decimal_places=2)
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    can_place_order = serializers.BooleanField()
    payment_methods = serializers.ListField(child=serializers.CharField())


# --- Checkout (order creation) ------------------------------------------------------------------


class ExpectedItemSerializer(serializers.Serializer):
    """What the customer's checkout screen last showed for one line — the staleness check compares
    this to the truth recomputed at commit time (ARCHITECTURE D29)."""

    listing_id = serializers.UUIDField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    availability = serializers.CharField()


class CheckoutSerializer(serializers.Serializer):
    vendor = serializers.CharField()
    fulfilment = serializers.ChoiceField(choices=[Order.PICKUP, Order.DELIVERY])
    address_id = serializers.UUIDField(required=False)
    payment_method = serializers.ChoiceField(choices=METHOD_CHOICES)
    customer_note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    idempotency_key = serializers.CharField(max_length=64, min_length=8)
    expected_items = ExpectedItemSerializer(many=True)
    simulate_failure = serializers.BooleanField(
        required=False, default=False, help_text="Dev/test only — forces the mock payment to fail."
    )

    def validate_simulate_failure(self, value):
        if value and settings.ENVIRONMENT == "production":
            raise serializers.ValidationError("Not available.")
        return value

    def validate(self, attrs):
        if attrs["fulfilment"] == Order.DELIVERY and not attrs.get("address_id"):
            raise serializers.ValidationError({"address_id": "Required when fulfilment is delivery."})
        return attrs


# --- Orders --------------------------------------------------------------------------------------


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["listing", "name", "unit", "unit_price", "quantity", "line_total"]


class OrderStatusEventSerializer(serializers.Serializer):
    """`actor_side` is precomputed onto each event by the view (`_attach_order_extras`) — cheaper
    than a method field re-deriving it per row from `event.order`, which isn't otherwise loaded."""

    status = serializers.CharField()
    note = serializers.CharField()
    actor_side = serializers.CharField()
    created_at = serializers.DateTimeField()


class _OrderVendorRefSerializer(serializers.Serializer):
    handle = serializers.CharField()
    vendor_id = serializers.CharField(source="display_handle")
    shop_name = serializers.CharField()
    public_phone = serializers.CharField()
    is_open = serializers.BooleanField()


class _OrderCustomerRefSerializer(serializers.Serializer):
    """What the *vendor* side sees about the buyer — name only, never phone (the same D14 rule
    `_ChatCustomerSerializer` already enforces for chat)."""

    id = serializers.UUIDField()
    name = serializers.CharField()


class OrderSerializer(serializers.ModelSerializer):
    vendor = _OrderVendorRefSerializer()
    customer = _OrderCustomerRefSerializer()
    items = OrderItemSerializer(many=True, read_only=True)
    events = OrderStatusEventSerializer(many=True, read_only=True)
    payment_status = serializers.SerializerMethodField()
    payment_provider = serializers.SerializerMethodField()
    review_id = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "number",
            "vendor",
            "customer",
            "fulfilment",
            "status",
            "delivery_address",
            "customer_note",
            "subtotal",
            "delivery_fee",
            "total",
            "payment_method",
            "payment_status",
            "payment_provider",
            "rejection_reason",
            "items",
            "events",
            "review_id",
            "created_at",
            "updated_at",
        ]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_payment_status(self, order):
        payments = list(order.payments.all())
        return payments[0].status if payments else None

    @extend_schema_field(serializers.UUIDField(allow_null=True))
    def get_review_id(self, order):
        """Phase 9 (ARCHITECTURE D30) — lets the order-tracking screen know, without guessing, whether
        this completed order already has a review (`uniq_review_per_order` guarantees at most one),
        so it can show "Rate your experience" vs. "You reviewed this order" without a failed POST.
        `order.reviews` is prefetched by every view building an `OrderSerializer` (`ORDER_PREFETCH`),
        so `.all()` here reads from that cache instead of issuing a query per order in a list."""
        reviews = list(order.reviews.all())
        return reviews[0].id if reviews else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_payment_provider(self, order):
        payments = list(order.payments.all())
        return payments[0].provider if payments else None


class AdminOrderListSerializer(serializers.ModelSerializer):
    """List row for GET /admin/orders — read-only operational visibility (master prompt §23). No
    payment/refund actions here; `_settle_payment` (checkout/transition flows) is the only writer of
    `Payment` rows, unchanged by Phase 11."""

    customer_name = serializers.CharField(source="customer.name", read_only=True)
    vendor_handle = serializers.CharField(source="vendor.handle", read_only=True)
    vendor_shop_name = serializers.CharField(source="vendor.shop_name", read_only=True)
    payment_status = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "number",
            "customer_name",
            "vendor_handle",
            "vendor_shop_name",
            "fulfilment",
            "status",
            "payment_method",
            "payment_status",
            "total",
            "created_at",
        ]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_payment_status(self, order):
        payments = list(order.payments.all())
        return payments[0].status if payments else None


class OrderListQuerySerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["customer", "vendor"])
    status = serializers.ChoiceField(
        choices=[c for c, _ in Order.STATUS_CHOICES], required=False, allow_blank=True, default=""
    )


class OrderTransitionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=transitions.ACTIONS)
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        rules_for_action = transitions.RULES.get(attrs["action"], {})
        if any(rule.requires_reason for rule in rules_for_action.values()) and not attrs.get("reason"):
            raise serializers.ValidationError({"reason": "A reason is required for this action."})
        return attrs
