"""Phase 10 — AI product detection: POST /ai/detections.

Covers master prompt §26's required backend test areas: auth, vendor authorization, upload
validation, successful/low-confidence/no-detection responses, OCR, barcode, taxonomy matching,
existing-product matching, AI failure handling, malformed provider response, and price-suggestion
provenance (with and without real market data on file).
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from vc.ai.detection import get_default_provider
from vc.ai.models import AIDetection
from vc.ai.providers import DetectionResult, Prediction
from vc.catalog.models import MarketPrice, Product

from .conftest import DETECTIONS, barcode_image_bytes, blank_image_bytes, label_image_bytes, upload_bytes

pytestmark = pytest.mark.django_db


def _detect(client, image_id: str):
    return client.post(DETECTIONS, {"image_id": image_id}, format="json")


# --- auth & authorization -------------------------------------------------------------------


def test_anonymous_cannot_scan():
    from rest_framework.test import APIClient

    r = APIClient().post(DETECTIONS, {"image_id": "00000000-0000-0000-0000-000000000000"}, format="json")
    assert r.status_code == 401


def test_customer_cannot_scan(api, customer):
    image_id = upload_bytes(api, blank_image_bytes())
    r = _detect(api, image_id)
    assert r.status_code == 403


# --- upload validation -----------------------------------------------------------------------


def test_unknown_image_id_is_rejected(vendor_client):
    r = _detect(vendor_client, "00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "image_not_found"


def test_another_users_image_cannot_be_scanned(vendor_client, api, customer):
    image_id = upload_bytes(api, blank_image_bytes())  # uploaded by the customer, not the vendor
    r = _detect(vendor_client, image_id)
    assert r.status_code == 404


def test_video_upload_cannot_be_scanned(vendor_client):
    r = vendor_client.post("/api/v1/media", {"file": _fake_video()}, format="multipart")
    assert r.status_code == 201, r.content
    image_id = r.json()["id"]
    r2 = _detect(vendor_client, image_id)
    assert r2.status_code == 400
    assert r2.json()["error"]["code"] == "unsupported_media"


def _fake_video():
    import io

    f = io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"0" * 64)
    f.name = "clip.mp4"
    return f


# --- successful detection: barcode ------------------------------------------------------------


def test_barcode_match_is_a_likely_detection(vendor_client, barcoded_tomato):
    image_id = upload_bytes(vendor_client, barcode_image_bytes())
    r = _detect(vendor_client, image_id)
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["status"] == "done"
    assert body["barcode"] == "4006381333931"
    assert body["predictions"][0]["product_slug"] == "tomato"
    assert body["predictions"][0]["source"] == "barcode"
    assert body["predictions"][0]["band"] == "likely"
    assert body["predictions"][0]["confidence"] >= 0.9
    assert "Tomato" in body["message"]
    assert "confidence" not in body["message"].lower()  # plain language, not raw ML jargon (§16/§33)
    assert body["provider"]["is_development"] is True
    assert body["provider"]["name"]


# --- successful detection: OCR -----------------------------------------------------------------


def test_ocr_text_is_matched_against_product_aliases(vendor_client):
    image_id = upload_bytes(vendor_client, label_image_bytes("TAMATAR HYBRID"))
    r = _detect(vendor_client, image_id)
    assert r.status_code == 201, r.content
    body = r.json()
    assert "TAMATAR" in body["ocr_text"].upper()
    top = body["predictions"][0]
    assert top["product_slug"] == "tomato"
    assert top["source"] == "ocr"
    assert top["variety_name"] == "Hybrid"
    assert 0 < top["confidence"] <= 1


# --- taxonomy matching: category/unit suggestion derived from the matched product --------------


def test_taxonomy_matching_supplies_category_and_unit(vendor_client, barcoded_tomato):
    image_id = upload_bytes(vendor_client, barcode_image_bytes())
    r = _detect(vendor_client, image_id)
    top = r.json()["predictions"][0]
    assert top["category_slug"] == "vegetables"
    assert top["unit"] == Product.objects.get(slug="tomato").default_unit


# --- no-detection: loose/unlabelled product is honestly "could not identify", never invented ---


def test_blank_image_yields_no_fabricated_detection(vendor_client):
    image_id = upload_bytes(vendor_client, blank_image_bytes())
    r = _detect(vendor_client, image_id)
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["status"] == "done"
    assert body["predictions"] == []
    assert body["suggested_price"] is None
    assert (
        "couldn't confidently identify" in body["message"].lower() or "could not confidently" in body["message"].lower()
    )


# --- existing-product matching ------------------------------------------------------------------


def test_existing_listing_is_surfaced_when_vendor_already_lists_the_product(
    vendor_client, barcoded_tomato, tomato_listing
):
    image_id = upload_bytes(vendor_client, barcode_image_bytes())
    r = _detect(vendor_client, image_id)
    body = r.json()
    assert body["existing_listing"] == {"id": tomato_listing["id"], "name": tomato_listing["name"]}


def test_no_existing_listing_when_vendor_has_none(vendor_client, barcoded_tomato):
    image_id = upload_bytes(vendor_client, barcode_image_bytes())
    r = _detect(vendor_client, image_id)
    assert r.json()["existing_listing"] is None


# --- price-suggestion provenance -----------------------------------------------------------------


def test_price_suggestion_is_unavailable_when_no_market_data_exists(vendor_client, barcoded_tomato):
    """The real, currently-empty state of `catalog_marketprice` in this environment — honestly
    "unavailable," never an invented number (master prompt §15/§30)."""
    assert not MarketPrice.objects.filter(product__slug="tomato").exists()
    image_id = upload_bytes(vendor_client, barcode_image_bytes())
    r = _detect(vendor_client, image_id)
    assert r.json()["suggested_price"] is None


def test_price_suggestion_carries_real_source_and_date_when_market_data_exists(vendor_client, barcoded_tomato):
    tomato = Product.objects.get(slug="tomato")
    MarketPrice.objects.create(
        product=tomato,
        region="Gurugram",
        unit="kg",
        min_price=Decimal("25.00"),
        max_price=Decimal("32.00"),
        source="Agmarknet (Gurugram mandi)",
        observed_at=datetime(2026, 9, 1, tzinfo=UTC),
    )
    image_id = upload_bytes(vendor_client, barcode_image_bytes())
    r = _detect(vendor_client, image_id)
    price = r.json()["suggested_price"]
    assert price["min"] == "25.00"
    assert price["max"] == "32.00"
    assert price["region"] == "Gurugram"
    assert price["source"] == "Agmarknet (Gurugram mandi)"
    assert price["observed_at"].startswith("2026-09-01")


# --- AI failure handling: any provider exception is a clean failed detection, never a 500 ------


class _RaisingProvider:
    name, version, is_development = "test-raising", "0", True

    def detect(self, image_bytes: bytes) -> DetectionResult:
        raise TimeoutError("simulated provider timeout / network failure / rate limit")


def test_provider_exception_is_a_failed_detection_not_a_500(vendor_client, monkeypatch):
    monkeypatch.setattr("vc.ai.detection.get_default_provider", lambda: _RaisingProvider())
    image_id = upload_bytes(vendor_client, blank_image_bytes())
    r = _detect(vendor_client, image_id)
    assert r.status_code == 201  # the *request* succeeded; the *scan* honestly failed
    body = r.json()
    assert body["status"] == "failed"
    assert body["error"] == "provider_error"
    assert body["predictions"] == []
    assert "try again" in body["message"].lower() or "add the product" in body["message"].lower()
    assert AIDetection.objects.get(id=body["id"]).status == AIDetection.S_FAILED


# --- malformed provider response: never trusted blindly, never crashes -------------------------


class _MalformedProvider:
    name, version, is_development = "test-malformed", "0", True

    def detect(self, image_bytes: bytes) -> DetectionResult:
        return DetectionResult(
            predictions=[
                {"confidence": "not-a-number"},  # unusable — must be dropped
                {"confidence": 5.0, "label": "Suspiciously Certain Thing", "product_slug": "does-not-exist"},
                Prediction(
                    product_slug="tomato",
                    product_name="Tomato",
                    variety_id=None,
                    variety_name=None,
                    label="Tomato",
                    confidence=1.7,  # out of range — must be clamped to 1.0
                    source="ocr",
                ),
            ],
            barcode="",
            ocr_text="",
        )


def test_malformed_provider_response_is_sanitized_not_trusted(vendor_client, monkeypatch):
    monkeypatch.setattr("vc.ai.detection.get_default_provider", lambda: _MalformedProvider())
    image_id = upload_bytes(vendor_client, blank_image_bytes())
    r = _detect(vendor_client, image_id)
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["status"] == "done"
    # The unusable entry (non-numeric confidence) is dropped; the unknown-slug entry is kept but
    # stripped of the product it doesn't actually match; the out-of-range one is clamped, not
    # trusted verbatim.
    slugs_and_confidence = [(p["product_slug"], p["confidence"]) for p in body["predictions"]]
    assert "does-not-exist" not in [p["product_slug"] for p in body["predictions"]]
    assert any(slug == "tomato" and confidence == 1.0 for slug, confidence in slugs_and_confidence)
    assert all(0 <= p["confidence"] <= 1 for p in body["predictions"])


# --- provider factory sanity (no network/model dependency in this environment) -----------------


def test_default_provider_is_the_local_honest_provider():
    provider = get_default_provider()
    assert provider.is_development is True
    assert provider.name == "vendorconnect-local-detector"
