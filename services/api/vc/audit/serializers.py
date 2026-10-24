from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    """Admin-facing read shape. `ip_hash`/`request_id` are left off deliberately — they're
    operational/debugging fields with no moderation value, and the admin panel's own privacy
    principle (master prompt §24: "minimize exposed personal information") argues for the smaller
    surface rather than exposing every column just because the model has it."""

    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "actor_name", "actor_role", "action", "target_type", "target_id", "metadata", "created_at"]

    def get_actor_name(self, obj) -> str | None:
        return obj.actor.name or obj.actor.masked_phone if obj.actor else None
