from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class Report(TimeStampedModel):
    """User reports on vendors, listings, posts, reviews, messages, users. Also used for disputes."""

    TARGETS = ["vendor", "listing", "post", "review", "message", "user", "order"]
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="reports_made"
    )
    target_type = models.CharField(max_length=10, choices=[(t, t) for t in TARGETS])
    target_id = models.UUIDField()
    reason = models.CharField(max_length=40, help_text="spam | wrong_info | abusive | fraud | other")
    details = models.CharField(max_length=1000, blank=True)
    status = models.CharField(
        max_length=12, default="open", db_index=True, help_text="open | reviewing | resolved | dismissed"
    )
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    resolution = models.CharField(max_length=500, blank=True)

    class Meta:
        indexes = [models.Index(fields=["target_type", "target_id"])]
