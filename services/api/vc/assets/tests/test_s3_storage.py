"""Phase 13 (ARCHITECTURE D34): `S3MediaStorage` against a mocked bucket (`moto`) — a real S3 API,
in-process, proving `save`/`url`/`delete`/`read` actually work without a real AWS account, real
network access, or real credentials. `get_media_storage()`'s backend selection is covered too."""

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from vc.assets.storage import LocalMediaStorage, S3MediaStorage, get_media_storage

BUCKET = "vc-test-media"
REGION = "ap-south-1"


@pytest.fixture
def s3_storage(settings):
    settings.MEDIA_STORAGE_BACKEND = "s3"
    settings.AWS_STORAGE_BUCKET_NAME = BUCKET
    settings.AWS_S3_REGION_NAME = REGION
    with mock_aws():
        boto3.client("s3", region_name=REGION).create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        yield S3MediaStorage()


def test_get_media_storage_defaults_to_local(settings):
    settings.MEDIA_STORAGE_BACKEND = "local"
    assert isinstance(get_media_storage(), LocalMediaStorage)


def test_get_media_storage_selects_s3_backend(settings):
    settings.MEDIA_STORAGE_BACKEND = "s3"
    settings.AWS_STORAGE_BUCKET_NAME = BUCKET
    with mock_aws():
        assert isinstance(get_media_storage(), S3MediaStorage)


def test_save_then_read_round_trips_real_bytes(s3_storage):
    key = s3_storage.save("images/abc123-large.webp", b"fake webp bytes")
    assert key == "images/abc123-large.webp"
    assert s3_storage.read(key) == b"fake webp bytes"


def test_save_sets_content_type_from_the_key_extension(s3_storage):
    key = s3_storage.save("images/abc123-large.webp", b"data")
    head = boto3.client("s3", region_name=REGION).head_object(Bucket=BUCKET, Key=key)
    assert head["ContentType"] == "image/webp"


def test_url_is_a_presigned_get_not_a_permanent_public_link(s3_storage):
    key = s3_storage.save("videos/abc123.mp4", b"data")
    url = s3_storage.url(key)
    assert BUCKET in url
    # Proves it's a time-limited presigned URL, not a bare public object URL — the bucket is
    # otherwise fully private (Block Public Access ON, no bucket policy, no object ACLs).
    assert "X-Amz-Signature" in url and "X-Amz-Expires" in url


def test_url_expiry_is_configurable(s3_storage, settings):
    settings.MEDIA_S3_SIGNED_URL_EXPIRY_SECONDS = 120
    key = s3_storage.save("images/abc123-large.webp", b"data")
    assert "X-Amz-Expires=120" in s3_storage.url(key)


def test_delete_removes_the_object(s3_storage):
    key = s3_storage.save("images/abc123-large.webp", b"data")
    s3_storage.delete(key)
    with pytest.raises(ClientError):
        s3_storage.read(key)


def test_rejects_path_traversal_key(s3_storage):
    """Defence in depth: `uploads.py` never generates a key like this, but the storage layer
    doesn't trust that on faith either."""
    with pytest.raises(ValueError):
        s3_storage.save("../../etc/passwd", b"data")


def test_leading_slash_is_normalised_not_rejected(s3_storage):
    key = s3_storage.save("/images/abc123-large.webp", b"data")
    assert key == "images/abc123-large.webp"
