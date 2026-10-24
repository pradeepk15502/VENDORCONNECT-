"""Phase 12 hardening: `AIDetectionCreateView` runs synchronous, CPU-bound OCR/barcode inference —
becoming a vendor is instant self-serve, so a dedicated throttle scope (`ai_detection`) caps it
separately from the generic per-user CRUD budget."""

import pytest

from vc.ai.views import AiDetectionThrottle

from .conftest import DETECTIONS, blank_image_bytes, upload_bytes

pytestmark = pytest.mark.django_db


def _detect(client, image_id: str):
    return client.post(DETECTIONS, {"image_id": image_id}, format="json")


def test_ai_detection_is_rate_limited(monkeypatch, vendor_client):
    # DRF's `SimpleRateThrottle.THROTTLE_RATES` is a class attribute bound to `api_settings` once at
    # import time — overriding `settings.REST_FRAMEWORK` at test time doesn't reach it (a well-known
    # DRF-testing gotcha). Setting `rate` directly is what DRF's own test suite does for this reason:
    # `SimpleRateThrottle.__init__` uses it as-is and skips the settings lookup entirely.
    monkeypatch.setattr(AiDetectionThrottle, "rate", "1/hour", raising=False)

    image_id = upload_bytes(vendor_client, blank_image_bytes())
    first = _detect(vendor_client, image_id)
    assert first.status_code == 201, first.content

    image_id_2 = upload_bytes(vendor_client, blank_image_bytes())
    second = _detect(vendor_client, image_id_2)
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limited"
