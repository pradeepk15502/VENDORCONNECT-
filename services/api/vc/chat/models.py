from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class Chat(TimeStampedModel):
    """One conversation per (customer, vendor)."""

    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chats")
    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="chats")
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    customer_last_read_at = models.DateTimeField(null=True, blank=True)
    vendor_last_read_at = models.DateTimeField(null=True, blank=True)
    blocked_by_vendor = models.BooleanField(default=False)
    blocked_by_customer = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["customer", "vendor"], name="uniq_chat")]


class Message(models.Model):
    KIND_CHOICES = [
        ("text", "Text"),
        ("image", "Image"),
        ("product", "Product"),
        ("order", "Order"),
        ("system", "System"),
    ]

    id = models.BigAutoField(primary_key=True)  # internal only; exposed via public_id
    public_id = models.UUIDField(unique=True, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    sender_side = models.CharField(max_length=8, help_text="customer | vendor | system")
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default="text")
    text = models.CharField(max_length=2000, blank=True)
    listing = models.ForeignKey("catalog.VendorProduct", null=True, blank=True, on_delete=models.SET_NULL)
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL)
    asset = models.ForeignKey("assets.MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    client_message_id = models.CharField(max_length=64, blank=True, help_text="idempotency for retries")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["chat", "id"])]
        constraints = [
            models.UniqueConstraint(
                fields=["chat", "client_message_id"], condition=~models.Q(client_message_id=""), name="uniq_client_msg"
            )
        ]


class QuickReply(models.Model):
    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="quick_replies")
    text = models.CharField(max_length=200)
    position = models.PositiveSmallIntegerField(default=0)
