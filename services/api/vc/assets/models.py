from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class MediaAsset(TimeStampedModel):
    """Metadata for a file in object storage. Blobs never live in PostgreSQL."""

    KIND_IMAGE, KIND_VIDEO = "image", "video"
    STATUS_PENDING, STATUS_READY, STATUS_REJECTED = "pending", "ready", "rejected"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="media")
    kind = models.CharField(max_length=10, choices=[(KIND_IMAGE, "Image"), (KIND_VIDEO, "Video")])
    storage_key = models.CharField(max_length=300, unique=True, help_text="Random key, never the user's filename")
    content_type = models.CharField(max_length=60)
    size_bytes = models.PositiveIntegerField()
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    variants = models.JSONField(default=dict, blank=True, help_text='{"thumb": key, "medium": key, "large": key}')
    status = models.CharField(max_length=10, default=STATUS_PENDING)
    sha256 = models.CharField(max_length=64, blank=True, db_index=True)
