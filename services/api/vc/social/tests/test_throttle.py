"""Phase 12 hardening: filing a report requires no relationship to the target and has no per-target
cooldown, so a dedicated throttle scope (`report_submit`, shared with chat's report endpoint —
vc/core/throttles.py) caps repeat filings separately from the generic per-user CRUD budget."""

import io

import pytest
from PIL import Image

from vc.core.throttles import ReportSubmitThrottle

pytestmark = pytest.mark.django_db

MEDIA = "/api/v1/media"
MY_POSTS = "/api/v1/vendors/me/posts"


def _jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (600, 400), (0, 180, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(client) -> str:
    f = io.BytesIO(_jpeg_bytes())
    f.name = "stock.jpg"
    r = client.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    return r.json()["id"]


def _create_post(client, media_ids, **extra):
    payload = {"kind": "new_stock", "caption": "Fresh Hybrid Tomatoes Arrived", "media_asset_ids": media_ids, **extra}
    return client.post(MY_POSTS, payload, format="json")


def test_report_post_is_rate_limited(monkeypatch, api, customer, vendor_client):
    monkeypatch.setattr(ReportSubmitThrottle, "rate", "1/hour", raising=False)
    post_a = _create_post(vendor_client, [_upload(vendor_client)]).json()
    post_b = _create_post(vendor_client, [_upload(vendor_client)]).json()

    first = api.post(f"/api/v1/posts/{post_a['id']}/report", {"reason": "spam"}, format="json")
    assert first.status_code == 201, first.content

    # A different target, same reporter — the cap is per-user, not per-target, since the abuse
    # this closes is one account flooding the report queue, not just re-reporting one thing.
    second = api.post(f"/api/v1/posts/{post_b['id']}/report", {"reason": "spam"}, format="json")
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limited"
