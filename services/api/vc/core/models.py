import uuid

from django.db import models


class TimeStampedModel(models.Model):
    """UUID primary key + timestamps. UUIDs are safe to expose; no sequential IDs leak."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["-created_at"]
