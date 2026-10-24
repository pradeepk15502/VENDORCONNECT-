from rest_framework import serializers

from vc.assets.storage import get_media_storage

from .detection import existing_listing_for, message_for
from .models import AIDetection


class AIDetectRequestSerializer(serializers.Serializer):
    """POST /ai/detections. `image_id` must be an image the caller uploaded themselves (checked in
    the view, never trusted from a client-supplied owner/vendor field — master prompt §20)."""

    image_id = serializers.UUIDField()


class AIPredictionSerializer(serializers.Serializer):
    """Read-only shape of one entry already stored in `AIDetection.predictions` (a plain dict —
    see `vc/ai/detection.py::_sanitize_prediction`)."""

    product_slug = serializers.CharField(allow_null=True)
    product_name = serializers.CharField(allow_null=True)
    variety_id = serializers.CharField(allow_null=True)
    variety_name = serializers.CharField(allow_null=True)
    category_slug = serializers.CharField(allow_null=True)
    category_name = serializers.CharField(allow_null=True)
    unit = serializers.CharField(allow_null=True)
    label = serializers.CharField()
    confidence = serializers.FloatField()
    band = serializers.CharField()
    source = serializers.CharField()


class AISuggestedPriceSerializer(serializers.Serializer):
    min = serializers.CharField()
    max = serializers.CharField()
    unit = serializers.CharField()
    region = serializers.CharField()
    source = serializers.CharField()
    observed_at = serializers.CharField()


class AIExistingListingSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()


class AIDetectionSerializer(serializers.ModelSerializer):
    """Full detail for one scan — what the confirmation screen renders (master prompt §17)."""

    image_url = serializers.SerializerMethodField()
    provider = serializers.SerializerMethodField()
    predictions = AIPredictionSerializer(many=True)
    suggested_price = AISuggestedPriceSerializer(allow_null=True)
    existing_listing = serializers.SerializerMethodField()
    message = serializers.SerializerMethodField()

    class Meta:
        model = AIDetection
        fields = [
            "id",
            "status",
            "image_url",
            "provider",
            "predictions",
            "barcode",
            "ocr_text",
            "suggested_price",
            "existing_listing",
            "message",
            "error",
            "vendor_corrected",
            "latency_ms",
            "created_at",
        ]

    def get_image_url(self, obj: AIDetection) -> str | None:
        if obj.image_id is None:
            return None
        return get_media_storage().url(obj.image.storage_key)

    def get_provider(self, obj: AIDetection) -> dict | None:
        if obj.model_version_id is None:
            return None
        mv = obj.model_version
        return {
            "name": mv.name,
            "version": mv.version,
            "is_development": bool(mv.metrics.get("is_development", True)),
        }

    def get_existing_listing(self, obj: AIDetection) -> dict | None:
        top = obj.predictions[0] if obj.predictions else None
        return existing_listing_for(obj.vendor, top)

    def get_message(self, obj: AIDetection) -> str:
        return message_for(obj)


class AIDetectionListItemSerializer(serializers.ModelSerializer):
    """Lightweight row for the vendor's own scan history and the admin operational list (master
    prompt §19/§25) — never a second product listing surface, just an audit trail."""

    top_label = serializers.SerializerMethodField()
    top_confidence = serializers.SerializerMethodField()
    provider = serializers.SerializerMethodField()
    vendor_handle = serializers.SerializerMethodField()

    class Meta:
        model = AIDetection
        fields = [
            "id",
            "vendor_handle",
            "status",
            "top_label",
            "top_confidence",
            "provider",
            "error",
            "vendor_corrected",
            "created_at",
        ]

    def get_top_label(self, obj: AIDetection) -> str | None:
        return obj.predictions[0]["label"] if obj.predictions else None

    def get_top_confidence(self, obj: AIDetection) -> float | None:
        return obj.predictions[0]["confidence"] if obj.predictions else None

    def get_provider(self, obj: AIDetection) -> str | None:
        return obj.model_version.name if obj.model_version_id else None

    def get_vendor_handle(self, obj: AIDetection) -> str:
        return obj.vendor.handle
