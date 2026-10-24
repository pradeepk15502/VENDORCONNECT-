"""Phase 9 (ARCHITECTURE D12): real upload validation + processing, not a stubbed pass-through."""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from vc.assets.models import MediaAsset

pytestmark = pytest.mark.django_db

MEDIA = "/api/v1/media"


def _jpeg_bytes(size=(800, 600), color=(255, 0, 0)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def test_upload_requires_auth():
    api = APIClient()
    r = api.post(MEDIA, {"file": io.BytesIO(_jpeg_bytes())}, format="multipart")
    assert r.status_code == 401


def test_upload_image_is_processed_into_webp_variants(customer, api):
    f = io.BytesIO(_jpeg_bytes((2000, 1000)))
    f.name = "tomato.jpg"
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["kind"] == "image"
    assert body["content_type"] == "image/webp"
    assert body["width"] == 2000 and body["height"] == 1000
    assert set(body["variant_urls"]) == {"large", "medium", "thumb"}
    assert body["url"] == body["variant_urls"]["large"]
    # Actually resized, not just relabelled — the large variant is capped at 1080px on its long side.
    for name, max_side in {"large": 1080, "medium": 480, "thumb": 160}.items():
        assert name in body["variant_urls"]


def test_upload_rejects_disguised_non_image(customer, api):
    """A `.jpg` filename and an `image/jpeg` Content-Type on bytes that are not actually a JPEG —
    the real check is Pillow decoding the bytes, not trusting either client-supplied signal."""
    f = io.BytesIO(b"this is not an image, just text pretending to be one" * 20)
    f.name = "fake.jpg"  # the test client infers Content-Type: image/jpeg from this extension alone
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"


def test_upload_rejects_oversized_image(customer, api, settings):
    settings.MEDIA_MAX_IMAGE_MB = 1
    # A 2000x2000 solid-color JPEG comfortably exceeds 1 MB uncompressed-ish but let's force it with noise.
    import random

    random.seed(0)
    img = Image.new("RGB", (1500, 1500))
    img.putdata([(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)) for _ in range(1500 * 1500)])
    buf = io.BytesIO()
    img.save(buf, format="PNG")  # PNG of random noise compresses poorly -> comfortably over 1 MB
    buf.seek(0)
    buf.name = "big.png"
    r = api.post(MEDIA, {"file": buf}, format="multipart")
    assert r.status_code == 400
    # A bare `serializers.ValidationError("...")` raised outside a serializer's own `is_valid()`
    # still goes through the project's uniform error envelope (vc/core/exceptions.py): the
    # top-level message is always "Some fields are invalid.", with the real reason in `details`.
    assert "too large" in str(r.json()["error"]["details"]).lower()


def test_upload_rejects_unsupported_type(customer, api):
    f = io.BytesIO(b"%PDF-1.4 fake pdf content")
    f.name = "doc.pdf"
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 400


def test_upload_video_accepted_without_transcoding(customer, api):
    """Documented limitation (ARCHITECTURE D12): video is validated and stored, not re-encoded, so
    there are no resized variants and dimensions are not measured."""
    f = io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"0" * 1000)  # not a real playable mp4, just bytes
    f.name = "clip.mp4"
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["kind"] == "video"
    assert body["variant_urls"] == {}
    assert body["width"] is None


def test_upload_rejects_video_content_type_with_mismatched_extension(customer, api):
    """Phase 12 hardening: a client used to be able to claim `Content-Type: video/mp4` on a file
    named anything at all and have it stored, byte-for-byte, under that attacker-chosen extension —
    videos have no Pillow-style decode step to catch this the way images do, so both signals must
    now agree with the allowlist before anything is accepted as video."""
    f = SimpleUploadedFile("xss.html", b"<script>alert(document.cookie)</script>", content_type="video/mp4")
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    assert not MediaAsset.objects.filter(storage_key__icontains="html").exists()


def test_video_storage_key_extension_comes_from_content_type_not_filename(customer, api):
    """Even for an accepted video (both signals individually valid, just disagreeing with each
    other), the extension actually written to storage must come from the validated Content-Type,
    never the client-supplied filename."""
    f = SimpleUploadedFile("clip.webm", b"\x00\x00\x00\x18ftypmp42" + b"0" * 1000, content_type="video/mp4")
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    asset = MediaAsset.objects.get(id=r.json()["id"])
    assert asset.storage_key.endswith(".mp4")  # from Content-Type, not the ".webm" filename


def test_upload_rejects_oversized_upload_before_reprocessing(customer, api, settings):
    """Phase 12 hardening: reject using the size Django's parser already knows (`f.size`) before
    `process_upload` re-reads/re-decodes the file — proven here by a file Pillow could never decode
    anyway (if the oversized check didn't run first, this would fail with 'not a valid image', not
    'too large')."""
    settings.MEDIA_MAX_IMAGE_MB = 1
    f = SimpleUploadedFile("big.jpg", b"not a real jpeg" * 100_000, content_type="image/jpeg")  # ~1.5 MB
    r = api.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 400
    assert "too large" in str(r.json()["error"]["details"]).lower()
