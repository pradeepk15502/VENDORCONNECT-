from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .models import MediaAsset
from .serializers import MediaAssetSerializer, MediaUploadSerializer
from .uploads import _guess_kind, process_upload


class MediaUploadThrottle(UserRateThrottle):
    """Phase 12 hardening: each upload decodes/re-encodes an image into 3 WebP variants (real CPU
    and storage cost) with no per-user quota anywhere else — the generic `user` throttle scope is
    sized for cheap CRUD, not this. See docs/ARCHITECTURE.md D33."""

    scope = "media_upload"


class MediaUploadView(APIView):
    """POST /media (multipart) — general-purpose upload used today by the vendor "Create Post"
    flow (Phase 9). Any authenticated user may upload (a future avatar/review-photo feature reuses
    the same endpoint); ownership is recorded so a later feature can enforce "only your own media"
    without a schema change."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [MediaUploadThrottle]

    @extend_schema(request=MediaUploadSerializer, responses={201: MediaAssetSerializer})
    def post(self, request):
        s = MediaUploadSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        f = s.validated_data["file"]
        # Phase 12 hardening: reject an oversized upload using the size Django's multipart parser
        # already recorded, before `process_upload` reads the whole thing into memory a second time
        # to check it. This is a secondary guard — the real ceiling belongs at the reverse proxy
        # (infrastructure/docker/nginx-spa.conf's `client_max_body_size`), which can reject an
        # oversized body before it ever reaches this process; this check only helps when nginx isn't
        # in front (e.g. hitting the API directly in dev).
        kind = _guess_kind(f.content_type or "", f.name or "")
        limit_mb = settings.MEDIA_MAX_IMAGE_MB if kind == MediaAsset.KIND_IMAGE else settings.MEDIA_MAX_VIDEO_MB
        if f.size and f.size > limit_mb * 1024 * 1024:
            raise serializers.ValidationError(f"File is too large (max {limit_mb} MB).")
        processed = process_upload(data=f.read(), content_type=f.content_type or "", filename=f.name or "")
        asset = MediaAsset.objects.create(
            owner=request.user,
            kind=processed.kind,
            storage_key=processed.storage_key,
            content_type=processed.content_type,
            size_bytes=processed.size_bytes,
            width=processed.width,
            height=processed.height,
            variants=processed.variants,
            status=MediaAsset.STATUS_READY,
            sha256=processed.sha256,
        )
        return Response(MediaAssetSerializer(asset).data, status=201)
