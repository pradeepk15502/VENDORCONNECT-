from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class Cart(TimeStampedModel):
    """One open cart per customer; items are grouped by vendor at read/checkout time."""

    customer = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cart")


class CartItem(TimeStampedModel):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="items")
    listing = models.ForeignKey("catalog.VendorProduct", on_delete=models.CASCADE, related_name="+")
    vendor = models.ForeignKey(
        "vendors.Vendor", on_delete=models.CASCADE, related_name="+", help_text="denormalised for grouping"
    )
    quantity = models.DecimalField(max_digits=8, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["cart", "listing"], name="uniq_cart_listing"),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="cart_qty_positive"),
        ]


class Order(TimeStampedModel):
    """Always exactly one vendor per order (never silently combined)."""

    PICKUP, DELIVERY = "pickup", "delivery"
    S_PLACED, S_ACCEPTED, S_REJECTED, S_PREPARING, S_READY = "placed", "accepted", "rejected", "preparing", "ready"
    S_OUT, S_DELIVERED, S_PICKED_UP, S_CANCELLED = "out_for_delivery", "delivered", "picked_up", "cancelled"
    # Added in Phase 8 (ARCHITECTURE D29): the master prompt's tracking timeline and vendor "Completed
    # orders" tab both need a terminal state distinct from picked_up/delivered — "the handover
    # happened" vs. "the order is done and archived" (e.g. cash actually collected, or a short window
    # for a same-day dispute) are different facts even though most orders reach one right after the
    # other.
    S_COMPLETED = "completed"
    STATUS_CHOICES = [
        (s, s.replace("_", " ").title())
        for s in [
            S_PLACED,
            S_ACCEPTED,
            S_REJECTED,
            S_PREPARING,
            S_READY,
            S_OUT,
            S_DELIVERED,
            S_PICKED_UP,
            S_COMPLETED,
            S_CANCELLED,
        ]
    ]

    number = models.CharField(max_length=20, unique=True, help_text="human-friendly, e.g. VC-24X7K9")
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.PROTECT, related_name="orders")
    fulfilment = models.CharField(max_length=10, choices=[(PICKUP, "Pickup"), (DELIVERY, "Delivery")])
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=S_PLACED, db_index=True)
    delivery_address = models.JSONField(null=True, blank=True, help_text="snapshot; only for delivery")
    customer_note = models.CharField(max_length=300, blank=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    delivery_fee = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=12, default="cash", help_text="cash | upi | online")
    rejection_reason = models.CharField(max_length=200, blank=True)
    idempotency_key = models.CharField(
        max_length=64,
        blank=True,
        help_text="client-generated, one per checkout attempt (Phase 8, ARCHITECTURE D29) — "
        "a retry with the same key returns the existing order instead of creating a second one",
    )

    class Meta:
        indexes = [
            models.Index(fields=["vendor", "status", "-created_at"]),
            models.Index(fields=["customer", "-created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="uniq_order_idempotency_key",
            )
        ]


class OrderItem(models.Model):
    """Snapshot of what was ordered — later price edits do not change past orders."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    listing = models.ForeignKey("catalog.VendorProduct", null=True, on_delete=models.SET_NULL, related_name="+")
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=10)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.DecimalField(max_digits=8, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)


class OrderStatusEvent(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(max_length=20)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class Payment(TimeStampedModel):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="payments")
    method = models.CharField(max_length=12)
    provider = models.CharField(max_length=30, blank=True)
    provider_ref = models.CharField(max_length=100, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=12, default="pending", help_text="pending | succeeded | failed | refunded")
