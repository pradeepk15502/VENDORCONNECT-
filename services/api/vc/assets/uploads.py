"""Upload validation + processing (Phase 9, ARCHITECTURE D12).

Images are decoded, EXIF-oriented, stripped of all EXIF/GPS metadata and re-encoded as WebP at
three sizes (1080/480/160px, per D12). The client's declared filename extension and Content-Type
are both checked, but neither is trusted as the real file type — the authoritative check is
Pillow actually decoding the bytes (`Image.open().verify()`), which is what magic-byte sniffing
means in practice without a separate `python-magic`/libmagic dependency.

Videos are validated by declared Content-Type, filename extension and size only, and are stored
byte-for-byte as uploaded. There is no ffmpeg/ffprobe pipeline in this project — duration and
dimension checks, transcoding and thumbnail generation for video are NOT implemented. This is a
documented limitation (README "Known limitations"), not a pretended feature: the interface accepts
a video and a real, playable file comes out the other end; it is just not re-encoded or measured.
"""

from __future__ import annotations

import hashlib
import io
import uuid
from dataclasses import dataclass

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

from .models import MediaAsset
from .storage import get_media_storage

IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
VIDEO_CONTENT_TYPES = {"video/mp4", "video/webm"}
VIDEO_EXTENSIONS = {"mp4", "webm"}
# Phase 12 hardening: the extension actually written to storage for a video upload, keyed by its
# validated Content-Type — never the client-supplied filename (see `_guess_kind`/`process_upload`
# below for why).
_VIDEO_EXTENSION_BY_CONTENT_TYPE = {"video/mp4": "mp4", "video/webm": "webm"}
VARIANT_MAX_SIDE = {"large": 1080, "medium": 480, "thumb": 160}


@dataclass(frozen=True)
class ProcessedUpload:
    kind: str
    storage_key: str
    content_type: str
    size_bytes: int
    width: int | None
    height: int | None
    variants: dict
    sha256: str


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _guess_kind(content_type: str, filename: str) -> str:
    """Images: whichever signal (Content-Type or extension) says "image" is enough to route into
    `_decode_image`, which is the real check — Pillow either decodes the bytes or it doesn't, so a
    generous guess here costs nothing.

    Video has no equivalent decode step (module docstring), so a generous OR-based guess would be
    the actual vulnerability: a client could claim `Content-Type: video/mp4` on a file named
    anything at all (`xss.html`, say) and have it stored, byte-for-byte, under that attacker-chosen
    extension (Phase 12 hardening — this used to be exactly that OR). Both signals must agree with
    the allowlist before something is accepted as video at all, and `process_upload` below never
    uses the client's filename extension when writing a video to storage regardless."""
    ext = _extension(filename)
    if content_type in IMAGE_CONTENT_TYPES or ext in IMAGE_EXTENSIONS:
        return MediaAsset.KIND_IMAGE
    if content_type in VIDEO_CONTENT_TYPES and ext in VIDEO_EXTENSIONS:
        return MediaAsset.KIND_VIDEO
    raise serializers.ValidationError("Unsupported file type. Use JPEG, PNG, WebP images, or MP4/WebM video.")


def _decode_image(data: bytes) -> Image.Image:
    """The real MIME check: only genuinely decodable image bytes pass, whatever the client claimed."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()  # Image.verify() alone leaves the file unusable for a second open/resize pass
    except (UnidentifiedImageError, OSError) as exc:
        raise serializers.ValidationError("File is not a valid image.") from exc
    if (img.format or "").lower() not in ("jpeg", "png", "webp"):
        raise serializers.ValidationError("Unsupported image format.")
    return img


def _fit(img: Image.Image, max_side: int) -> Image.Image:
    w, h = img.size
    if max(w, h) <= max_side:
        return img.copy()
    scale = max_side / max(w, h)
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))))


def process_upload(*, data: bytes, content_type: str, filename: str) -> ProcessedUpload:
    if not data:
        raise serializers.ValidationError("File is empty.")
    kind = _guess_kind(content_type or "", filename or "")
    size_mb = len(data) / (1024 * 1024)
    limit = settings.MEDIA_MAX_IMAGE_MB if kind == MediaAsset.KIND_IMAGE else settings.MEDIA_MAX_VIDEO_MB
    if size_mb > limit:
        raise serializers.ValidationError(f"File is too large (max {limit} MB).")

    storage = get_media_storage()
    sha = hashlib.sha256(data).hexdigest()
    base_key = f"{kind}s/{uuid.uuid4().hex}"

    if kind == MediaAsset.KIND_IMAGE:
        img = _decode_image(data)
        img = ImageOps.exif_transpose(img) or img  # apply rotation before we throw the EXIF away
        width, height = img.size
        rgb = img.convert("RGB")
        variants: dict[str, str] = {}
        for name, max_side in VARIANT_MAX_SIDE.items():
            buf = io.BytesIO()
            # No `exif=` kwarg passed — Pillow only writes EXIF when given one, so this is the
            # strip: what comes out has no orientation/GPS/camera metadata at all (ARCHITECTURE D12).
            _fit(rgb, max_side).save(buf, format="WEBP", quality=82)
            variants[name] = storage.save(f"{base_key}-{name}.webp", buf.getvalue())
        return ProcessedUpload(
            kind=kind,
            storage_key=variants["large"],
            content_type="image/webp",
            size_bytes=len(data),
            width=width,
            height=height,
            variants=variants,
            sha256=sha,
        )

    # Video: stored as-is (see module docstring for what's deliberately not implemented). The
    # extension comes from the validated Content-Type, never `filename` — `_guess_kind` above
    # already guarantees `content_type` is one of `_VIDEO_EXTENSION_BY_CONTENT_TYPE`'s keys by the
    # time we get here, so a client can't smuggle an arbitrary extension onto stored bytes it fully
    # controls by naming the upload something else (Phase 12 hardening).
    ext = _VIDEO_EXTENSION_BY_CONTENT_TYPE[content_type]
    storage_key = storage.save(f"{base_key}.{ext}", data)
    return ProcessedUpload(
        kind=kind,
        storage_key=storage_key,
        content_type=content_type or "video/mp4",
        size_bytes=len(data),
        width=None,
        height=None,
        variants={},
        sha256=sha,
    )
