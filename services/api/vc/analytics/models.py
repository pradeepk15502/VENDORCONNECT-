from django.db import models


class AnalyticsEvent(models.Model):
    """Privacy-conscious product analytics. No raw phone/email; coords rounded; actor is a salted hash."""

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=40, db_index=True)
    actor_hash = models.CharField(max_length=64, blank=True, db_index=True)
    actor_role = models.CharField(max_length=10, blank=True)
    vendor_handle = models.CharField(max_length=16, blank=True, db_index=True)
    properties = models.JSONField(default=dict, blank=True)
    platform = models.CharField(max_length=20, blank=True)
    occurred_at = models.DateTimeField(db_index=True)
    received_at = models.DateTimeField(auto_now_add=True)
