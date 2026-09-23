from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class AIModelVersion(TimeStampedModel):
    name = models.CharField(max_length=60)
    version = models.CharField(max_length=30)
    task = models.CharField(max_length=30, default="product_classification")
    taxonomy_version = models.CharField(max_length=30, blank=True)
    metrics = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["name", "version"], name="uniq_model_version")]


class AIDetection(TimeStampedModel):
    """ai_detections: every scan and its outcome. Suggestions only — never auto-published."""

    S_PENDING, S_DONE, S_FAILED, S_CONFIRMED, S_DISCARDED = "pending", "done", "failed", "confirmed", "discarded"

    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="ai_detections")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    image = models.ForeignKey("assets.MediaAsset", null=True, on_delete=models.SET_NULL, related_name="+")
    model_version = models.ForeignKey(AIModelVersion, null=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=10, default=S_PENDING, db_index=True)
    predictions = models.JSONField(default=list, blank=True, help_text="[{product_slug, variety, confidence}]")
    barcode = models.CharField(max_length=32, blank=True)
    ocr_text = models.CharField(max_length=500, blank=True)
    suggested_price = models.JSONField(null=True, blank=True, help_text="{min,max,unit,source,observed_at}")
    confirmed_listing = models.ForeignKey(
        "catalog.VendorProduct", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    vendor_corrected = models.BooleanField(
        default=False, help_text="vendor chose a different product (training signal)"
    )
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    error = models.CharField(max_length=200, blank=True)
