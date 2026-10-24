"""Object-storage abstraction for uploaded media (Phase 9, ARCHITECTURE D12; S3 backend added
Phase 13, ARCHITECTURE D34).

`LocalMediaStorage` is a real, working implementation — files really are written and really are
served (`config/urls.py` mounts MEDIA_URL under DEBUG) — backed by Django's own filesystem storage
under MEDIA_ROOT. It is the dev/CI backend, not a mock: nothing about an uploaded file is faked.

`S3MediaStorage` is the production backend (Phase 13): callers (`uploads.py`, `serializers.py`)
never touch a filesystem or bucket directly, and never learn which implementation is live —
exactly the same shape as `vc/orders/payments.py`'s `get_payment_provider()`.
"""

from __future__ import annotations

import mimetypes
import re
from typing import Protocol

import boto3
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

# Defence in depth only: every real caller (`vc/assets/uploads.py`) already generates its own
# `uuid4().hex`-based key, so nothing here ever receives a caller-supplied path component — this
# just refuses anything that doesn't look like one of those keys before it reaches S3.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$")


class MediaStorage(Protocol):
    def save(self, key: str, content: bytes) -> str: ...

    def url(self, key: str) -> str: ...

    def delete(self, key: str) -> None: ...

    def read(self, key: str) -> bytes: ...


class LocalMediaStorage:
    """Django's configured default file storage — `FileSystemStorage` under MEDIA_ROOT in dev/CI."""

    def save(self, key: str, content: bytes) -> str:
        return default_storage.save(key, ContentFile(content))

    def url(self, key: str) -> str:
        return default_storage.url(key)

    def delete(self, key: str) -> None:
        if default_storage.exists(key):
            default_storage.delete(key)

    def read(self, key: str) -> bytes:
        """Phase 10: the AI detection pipeline is the first caller that needs the actual bytes back
        (to decode a barcode / run OCR) rather than just a servable URL."""
        with default_storage.open(key, "rb") as f:
            return f.read()


class S3MediaStorage:
    """Production media backend: a private Amazon S3 bucket (Phase 13, ARCHITECTURE D34).

    A thin boto3 wrapper, not `django-storages`' `S3Boto3Storage`: `MediaStorage`'s own four-method
    Protocol is narrower than Django's full Storage API, and a wrapper scoped to exactly what this
    app uses is both simpler and easier to test against a mocked bucket (`moto`) than configuring
    django-storages' broader surface for capabilities (Django `Storage`/`File` integration,
    `staticfiles` support, ...) nothing here needs — production never routes media through Django's
    own `default_storage`.

    The bucket is assumed fully private: S3 Block Public Access ON, no public bucket policy, and
    this class never sets an object ACL. Every `url()` is therefore a short-lived, presigned GET —
    never a permanent public link — which is deliberately the same all-or-nothing shape
    `LocalMediaStorage` already has in dev (nothing in the app today distinguishes "public" from
    "private" media at the storage layer; introducing that split — e.g. a CDN-cached public path
    for storefront banners — is future work for whenever such an asset class actually exists, not
    something to invent here).
    """

    def __init__(self) -> None:
        self._bucket = settings.AWS_STORAGE_BUCKET_NAME
        self._client = boto3.client("s3", region_name=settings.AWS_S3_REGION_NAME)

    @staticmethod
    def _safe_key(key: str) -> str:
        key = key.lstrip("/")
        if not key or ".." in key.split("/") or not _SAFE_KEY.match(key):
            raise ValueError(f"unsafe storage key: {key!r}")
        return key

    def save(self, key: str, content: bytes) -> str:
        key = self._safe_key(key)
        content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
        self._client.put_object(Bucket=self._bucket, Key=key, Body=content, ContentType=content_type)
        return key

    def url(self, key: str) -> str:
        key = self._safe_key(key)
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=settings.MEDIA_S3_SIGNED_URL_EXPIRY_SECONDS,
        )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=self._safe_key(key))

    def read(self, key: str) -> bytes:
        obj = self._client.get_object(Bucket=self._bucket, Key=self._safe_key(key))
        return obj["Body"].read()


def get_media_storage() -> MediaStorage:
    """Phase 13 (ARCHITECTURE D34): selects the S3-backed implementation when
    `MEDIA_STORAGE_BACKEND=s3` (staging/production), the local filesystem implementation
    otherwise — development/CI still need no AWS credentials at all, exactly as ARCHITECTURE D12
    originally established; only the selection changed here, never the interface or its callers."""
    if settings.MEDIA_STORAGE_BACKEND == "s3":
        return S3MediaStorage()
    return LocalMediaStorage()
