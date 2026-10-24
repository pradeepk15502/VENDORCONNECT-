from rest_framework import serializers


class _UserMetricsSerializer(serializers.Serializer):
    total = serializers.IntegerField(help_text="All accounts, any time.")
    new = serializers.IntegerField(help_text="date_joined within the selected period.")
    active = serializers.IntegerField(help_text="last_login within the selected period.")


class _VendorMetricsSerializer(serializers.Serializer):
    total = serializers.IntegerField(help_text="All shops, any time (not period-scoped).")
    pending_verification = serializers.IntegerField()
    active = serializers.IntegerField()
    suspended = serializers.IntegerField()


class _ProductMetricsSerializer(serializers.Serializer):
    total = serializers.IntegerField(help_text="Active catalog taxonomy entries (not vendor listings).")
    active_listings = serializers.IntegerField(help_text="VendorProduct rows with status=active.")
    out_of_stock_listings = serializers.IntegerField()


class _OrderMetricsSerializer(serializers.Serializer):
    total = serializers.IntegerField(help_text="Orders placed within the selected period.")
    pending = serializers.IntegerField(help_text="In-flight: not yet completed, cancelled or rejected.")
    completed = serializers.IntegerField()
    cancelled = serializers.IntegerField(help_text="Cancelled or rejected.")


class _ModerationMetricsSerializer(serializers.Serializer):
    open_reports = serializers.IntegerField(help_text="Current backlog (open/reviewing), not period-scoped.")
    reported_posts = serializers.IntegerField(help_text="Distinct posts newly reported within the period.")
    reported_reviews = serializers.IntegerField(help_text="Distinct reviews newly reported within the period.")
    hidden_content = serializers.IntegerField(help_text="Currently-hidden posts + reviews, not period-scoped.")


class _AIMetricsSerializer(serializers.Serializer):
    detections = serializers.IntegerField(help_text="Scans attempted within the selected period.")
    failed_detections = serializers.IntegerField()
    dev_scanner_usage = serializers.IntegerField(
        help_text="Detections from a model version flagged is_development (currently: all of them — see docs/AI.md)."
    )


class AdminDashboardSerializer(serializers.Serializer):
    """GET /admin/dashboard — every number here is a real, freshly-run DB aggregate for the
    requested period; there is no cached or fabricated figure (master prompt §4: "Do not fabricate
    numbers. If there is no data: show 0 / empty state.")."""

    range = serializers.ChoiceField(choices=["today", "7d", "30d", "custom"])
    period_start = serializers.DateTimeField()
    period_end = serializers.DateTimeField()
    users = _UserMetricsSerializer()
    vendors = _VendorMetricsSerializer()
    products = _ProductMetricsSerializer()
    orders = _OrderMetricsSerializer()
    moderation = _ModerationMetricsSerializer()
    ai = _AIMetricsSerializer()
