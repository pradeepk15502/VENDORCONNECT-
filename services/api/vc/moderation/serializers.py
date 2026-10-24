from rest_framework import serializers

from vc.social.models import Post, Review

from .models import Report


class ReportSerializer(serializers.ModelSerializer):
    reporter_name = serializers.SerializerMethodField()
    handled_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            "id",
            "reporter_name",
            "target_type",
            "target_id",
            "reason",
            "details",
            "status",
            "resolution",
            "handled_by_name",
            "created_at",
        ]

    def get_reporter_name(self, obj: Report) -> str:
        return obj.reporter.name if obj.reporter else ""

    def get_handled_by_name(self, obj: Report) -> str:
        return obj.handled_by.name if obj.handled_by else ""


class ReportResolveSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["resolved", "dismissed"])
    resolution = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    # Only meaningful for a "resolved" post/review report — hides the reported content as part of
    # the same action, so a moderator doesn't need two separate screens for one decision.
    hide_target = serializers.BooleanField(required=False, default=False)


class AdminPostSerializer(serializers.ModelSerializer):
    vendor_handle = serializers.CharField(source="vendor.display_handle", read_only=True)
    shop_name = serializers.CharField(source="vendor.shop_name", read_only=True)

    class Meta:
        model = Post
        fields = ["id", "vendor_handle", "shop_name", "kind", "caption", "status", "like_count", "created_at"]


class AdminReviewSerializer(serializers.ModelSerializer):
    vendor_handle = serializers.CharField(source="vendor.display_handle", read_only=True)
    author_name = serializers.CharField(source="author.name", read_only=True)

    class Meta:
        model = Review
        fields = ["id", "vendor_handle", "author_name", "rating", "text", "status", "created_at"]
