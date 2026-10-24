"""Phase 5 — GET /vendors/me/summary, the vendor dashboard's stat tiles.

Listings are created through the real POST /vendor-products / POST /inventory endpoints (not
model shortcuts), matching the rest of this suite's "exercise the real API" convention."""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

SUMMARY = "/api/v1/vendors/me/summary"
VENDOR_PRODUCTS = "/api/v1/vendor-products"
INVENTORY = "/api/v1/inventory"

MINIMAL = {"category": "vegetables", "name": "Fresh Spinach Bundle", "price": "20", "unit": "bundle"}


def _create(client, **overrides):
    r = client.post(VENDOR_PRODUCTS, {**MINIMAL, **overrides}, format="json")
    assert r.status_code == 201, r.content
    return r.json()


def test_summary_reflects_shop_status_and_zero_listings(vendor_client):
    r = vendor_client.get(SUMMARY)
    assert r.status_code == 200, r.content
    body = r.json()
    assert body == {
        "is_open": False,
        "status_changed_at": None,
        "product_count": 0,
        "low_stock_count": 0,
        "out_of_stock_count": 0,
    }
    # never a fake orders/sales figure — the fields simply don't exist until Phase 8
    assert "orders" not in body and "sales" not in body


def test_summary_counts_real_listings_by_availability(vendor_client):
    vendor_client.post("/api/v1/vendors/me/status", {"is_open": True}, format="json")

    ok = _create(vendor_client, name="Tomato")
    low = _create(vendor_client, name="Onion")
    out = _create(vendor_client, name="Potato")
    vendor_client.post(
        INVENTORY, {"listing_id": low["id"], "availability": "low_stock", "quantity": "3"}, format="json"
    )
    vendor_client.post(INVENTORY, {"listing_id": out["id"], "availability": "out_of_stock"}, format="json")

    r = vendor_client.get(SUMMARY)
    body = r.json()
    assert body["is_open"] is True
    assert body["status_changed_at"] is not None
    assert body["product_count"] == 3
    assert body["low_stock_count"] == 1
    assert body["out_of_stock_count"] == 1
    assert ok["availability"] == "in_stock"  # sanity: the untouched listing stayed in_stock


def test_summary_excludes_deleted_listings(vendor_client):
    gone = _create(vendor_client, name="Cabbage")
    _create(vendor_client, name="Cauliflower")
    assert vendor_client.delete(f"{VENDOR_PRODUCTS}/{gone['id']}").status_code == 204

    body = vendor_client.get(SUMMARY).json()
    assert body["product_count"] == 1


def test_summary_requires_authentication():
    assert APIClient().get(SUMMARY).status_code == 401


def test_customer_cannot_use_vendor_summary(customer, api):
    assert api.get(SUMMARY).status_code == 403
