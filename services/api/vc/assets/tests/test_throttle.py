"""Phase 12 hardening: each upload decodes/re-encodes into 3 WebP variants (real CPU + storage
cost) with no per-user quota anywhere else — `media_upload` caps it separately from the generic
per-user CRUD budget."""

import io

import pytest
from PIL import Image

from vc.assets.views import MediaUploadThrottle

pytestmark = pytest.mark.django_db

MEDIA = "/api/v1/media"


def _jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (10, 20, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def test_media_upload_is_rate_limited(monkeypatch, customer, api):
    monkeypatch.setattr(MediaUploadThrottle, "rate", "1/hour", raising=False)

    f1 = io.BytesIO(_jpeg_bytes())
    f1.name = "a.jpg"
    first = api.post(MEDIA, {"file": f1}, format="multipart")
    assert first.status_code == 201, first.content

    f2 = io.BytesIO(_jpeg_bytes())
    f2.name = "b.jpg"
    second = api.post(MEDIA, {"file": f2}, format="multipart")
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limited"
