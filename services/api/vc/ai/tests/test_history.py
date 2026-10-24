"""Phase 10 — scan history: GET /vendors/me/ai-detections (vendor's own audit trail) and
GET /admin/ai/detections (minimal staff operational visibility, master prompt §19/§25)."""

import pytest
from rest_framework.test import APIClient

from vc.accounts.models import User

from .conftest import DETECTIONS, barcode_image_bytes, blank_image_bytes, upload_bytes

pytestmark = pytest.mark.django_db

HISTORY = "/api/v1/vendors/me/ai-detections"
ADMIN_DETECTIONS = "/api/v1/admin/ai/detections"
_PASSWORD = "correct-horse-battery-staple"


def _scan(client, image_bytes: bytes):
    image_id = upload_bytes(client, image_bytes)
    return client.post(DETECTIONS, {"image_id": image_id}, format="json")


def _superuser_client(phone: str = "+919777777777") -> APIClient:
    User.objects.create_superuser(phone, _PASSWORD)
    client = APIClient()
    r = client.post("/api/v1/auth/admin/password", {"phone": phone, "password": _PASSWORD}, format="json")
    assert r.status_code == 200, r.content
    r2 = client.post(
        "/api/v1/auth/otp/verify", {"phone": phone, "code": r.json()["dev_otp"], "purpose": "admin"}, format="json"
    )
    assert r2.status_code == 200, r2.content
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r2.json()['access']}")
    return client


def test_vendor_sees_its_own_scan_history(vendor_client, barcoded_tomato):
    _scan(vendor_client, barcode_image_bytes())
    _scan(vendor_client, blank_image_bytes())

    r = vendor_client.get(HISTORY)
    assert r.status_code == 200, r.content
    rows = r.json()["results"]
    assert len(rows) == 2
    statuses = {row["status"] for row in rows}
    assert statuses == {"done"}
    top_labels = [row["top_label"] for row in rows]
    assert "Tomato" in top_labels
    assert None in top_labels  # the blank scan had nothing to suggest


def test_history_is_never_visible_to_another_vendor(vendor_client, barcoded_tomato):
    _scan(vendor_client, barcode_image_bytes())
    from .test_confirm import _second_vendor_client

    other = _second_vendor_client()
    r = other.get(HISTORY)
    assert r.status_code == 200
    assert r.json()["results"] == []


def test_customer_cannot_read_vendor_scan_history(api, customer):
    r = api.get(HISTORY)
    assert r.status_code == 403


# --- admin operational visibility --------------------------------------------------------------


def test_non_staff_cannot_see_admin_ai_list(vendor_client, barcoded_tomato):
    _scan(vendor_client, barcode_image_bytes())
    r = vendor_client.get(ADMIN_DETECTIONS)
    assert r.status_code in (401, 403)


def test_staff_sees_detections_across_vendors(vendor_client, barcoded_tomato):
    _scan(vendor_client, barcode_image_bytes())
    _scan(vendor_client, blank_image_bytes())

    admin = _superuser_client()
    r = admin.get(ADMIN_DETECTIONS)
    assert r.status_code == 200, r.content
    assert r.json()["count"] == 2

    filtered = admin.get(f"{ADMIN_DETECTIONS}?status=done")
    assert filtered.json()["count"] == 2

    none_failed = admin.get(f"{ADMIN_DETECTIONS}?status=failed")
    assert none_failed.json()["count"] == 0
