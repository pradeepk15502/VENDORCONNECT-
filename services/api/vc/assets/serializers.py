from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import MediaAsset
from .storage import get_media_storage


class MediaUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class MediaAssetSerializer(serializers.ModelSerializer):
    """`url` is the full-size (image: `large` variant) file; `variant_urls` gives every size a
    caller can pick from. Both are resolved through the storage abstraction, never a raw key —
    a caller never needs to know whether that key lives on disk or in a bucket."""

    url = serializers.SerializerMethodField()
    variant_urls = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = ["id", "kind", "content_type", "size_bytes", "width", "height", "url", "variant_urls", "created_at"]

    @extend_schema_field(serializers.URLField())
    def get_url(self, obj: MediaAsset) -> str:
        return get_media_storage().url(obj.storage_key)

    @extend_schema_field(serializers.DictField(child=serializers.URLField()))
    def get_variant_urls(self, obj: MediaAsset) -> dict:
        storage = get_media_storage()
        return {name: storage.url(key) for name, key in obj.variants.items()}
