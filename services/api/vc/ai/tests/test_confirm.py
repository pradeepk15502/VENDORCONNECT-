"""Phase 10 — POST /ai/detections/{id}/confirm: vendor confirmation, product creation, and
cross-vendor denial (master prompt §17/§18/§20/§26)."""

import pytest
from rest_framework.test import APIClient

from vc.ai.models import AIDetection
from vc.catalog.models import VendorProduct

from .conftest import DETECTIONS, barcode_image_bytes, blank_image_bytes, upload_bytes

pytestmark = pytest.mark.django_db


def _scan(client, image_bytes: bytes) -> str:
    image_id = upload_bytes(client, image_bytes)
    r = client.post(DETECTIONS, {"image_id": image_id}, format="json")
    assert r.status_code == 201, r.content
    return r.json()["id"]


def _confirm(client, detection_id: str, **overrides):
    payload = {
        "category": "vegetables",
        "product": "tomato",
        "name": "Tomato",
        "price": "28",
        "unit": "kg",
        **overrides,
    }
    return client.post(f"{DETECTIONS}/{detection_id}/confirm", payload, format="json")


# --- happy path: AI-assisted product creation reuses the real create path ----------------------


def test_confirming_a_barcode_detection_creates_a_real_listing(vendor_client, barcoded_tomato):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    r = _confirm(vendor_client, detection_id, variety=None)
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["source"] == "ai"
    assert body["product"]["slug"] == "tomato"

    # it is a real listing — the vendor's own product list shows it, exactly like a manual add
    listing_list = vendor_client.get("/api/v1/vendor-products").json()["results"]
    assert any(item["id"] == body["id"] and item["source"] == "ai" for item in listing_list)

    detection = AIDetection.objects.get(id=detection_id)
    assert detection.status == AIDetection.S_CONFIRMED
    assert str(detection.confirmed_listing_id) == body["id"]


def test_vendor_can_edit_every_field_before_confirming(vendor_client, barcoded_tomato):
    """The AI suggests; the vendor's submitted values — not the AI's — are what gets saved (master
    prompt §17: a fully editable form, not an accept-only prompt)."""
    detection_id = _scan(vendor_client, barcode_image_bytes())
    r = _confirm(vendor_client, detection_id, name="Farm Fresh Tomato", price="35.50", unit="kg")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["name"] == "Farm Fresh Tomato"
    assert body["price"] == "35.50"


def test_choosing_a_different_product_than_suggested_is_recorded_as_corrected(vendor_client, barcoded_tomato):
    """`vendor_corrected` is the training signal the AI docs describe — real, not decorative."""
    detection_id = _scan(vendor_client, barcode_image_bytes())  # top suggestion: tomato
    r = _confirm(vendor_client, detection_id, category="fruits", product="banana", name="Banana", unit="dozen")
    assert r.status_code == 201, r.content
    assert AIDetection.objects.get(id=detection_id).vendor_corrected is True


def test_accepting_the_top_suggestion_is_not_recorded_as_corrected(vendor_client, barcoded_tomato):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    r = _confirm(vendor_client, detection_id, variety=None)
    assert r.status_code == 201, r.content
    assert AIDetection.objects.get(id=detection_id).vendor_corrected is False


def test_manual_entry_is_still_available_after_a_no_detection_scan(vendor_client):
    """AI must never trap the vendor (master prompt §17/§21) — confirming with a fully manual,
    unrelated product after a "no detection" scan still works."""
    detection_id = _scan(vendor_client, blank_image_bytes())
    r = _confirm(
        vendor_client, detection_id, category="vegetables", product=None, name="My Own Special Mix", unit="packet"
    )
    assert r.status_code == 201, r.content
    assert r.json()["source"] == "ai"  # still went through the AI flow's confirm endpoint


def test_duplicate_listing_still_conflicts_the_same_way_as_manual_create(
    vendor_client, barcoded_tomato, tomato_listing
):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    r = _confirm(vendor_client, detection_id, variety=None, unit=tomato_listing["unit"])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "duplicate_listing"


def test_detection_cannot_be_confirmed_twice(vendor_client, barcoded_tomato):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    ok = _confirm(vendor_client, detection_id, variety=None)
    assert ok.status_code == 201
    again = _confirm(vendor_client, detection_id, name="Another Tomato Listing", unit="piece")
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "detection_already_used"


# --- authorization: a vendor never sees or acts on another vendor's scan -----------------------


def _second_vendor_client() -> APIClient:
    from conftest import login

    client = APIClient()
    login(client, "9333333333", "Second Vendor")
    r = client.post(
        "/api/v1/vendors",
        {
            "shop_name": "Other Shop",
            "category_slugs": ["vegetables"],
            "location": {
                "lat": 28.4595,
                "lng": 77.0266,
                "address_line": "Shop 2",
                "city": "Gurugram",
                "pincode": "122001",
            },
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    return client


def test_cross_vendor_cannot_view_detection(vendor_client, barcoded_tomato):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    other = _second_vendor_client()
    r = other.get(f"{DETECTIONS}/{detection_id}")
    assert r.status_code == 404


def test_cross_vendor_cannot_confirm_detection(vendor_client, barcoded_tomato):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    other = _second_vendor_client()
    r = _confirm(other, detection_id, variety=None)
    assert r.status_code == 404
    assert not VendorProduct.objects.filter(name="Tomato", vendor__owner__phone="+919333333333").exists()


def test_customer_cannot_confirm_a_detection(vendor_client, barcoded_tomato, api, customer):
    detection_id = _scan(vendor_client, barcode_image_bytes())
    r = _confirm(api, detection_id, variety=None)
    assert r.status_code == 403
