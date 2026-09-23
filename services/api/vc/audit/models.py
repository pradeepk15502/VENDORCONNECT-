from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Append-only trail of sensitive admin/vendor actions."""

    id = models.BigAutoField(primary_key=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    actor_role = models.CharField(max_length=12, blank=True)
    action = models.CharField(max_length=60, db_index=True, help_text="e.g. vendor.verified, auth.login")
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["target_type", "target_id"])]
