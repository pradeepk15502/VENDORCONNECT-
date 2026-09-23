from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class Notification(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(
        max_length=40,
        help_text="order_status | new_message | back_in_stock | new_post | low_stock | new_review | system",
    )
    title = models.CharField(max_length=140)
    body = models.CharField(max_length=500, blank=True)
    data = models.JSONField(default=dict, blank=True, help_text="deep-link payload")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "read_at", "-created_at"])]


class NotificationPreference(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_prefs")
    kind = models.CharField(max_length=40)
    in_app = models.BooleanField(default=True)
    push = models.BooleanField(default=True)
    sms = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "kind"], name="uniq_notif_pref")]


class PushSubscription(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.URLField(max_length=500, unique=True)
    keys = models.JSONField()
    user_agent = models.CharField(max_length=200, blank=True)
