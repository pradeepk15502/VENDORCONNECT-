"""Phase 4 — vendor-facing product/inventory/price management.

Uses the shared `vendor_client` fixture from conftest.py (a fully onboarded vendor, logged in via
the real OTP flow, shop created via the real POST /vendors — not a shortcut fixture)."""

from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from vc.catalog.models import InventoryEvent, PriceHistory, ProductVariety, VendorProduct

pytestmark = pytest.mark.django_db

VENDOR_PRODUCTS = "/api/v1/vendor-products"
INVENTORY = "/api/v1/inventory"
PRICES = "/api/v1/prices"

MINIMAL = {"category": "vegetables", "name": "Fresh Spinach Bundle", "price": "20", "unit": "bundle"}


def _second_vendor_client():
    """A second, independent vendor — for ownership-isolation tests."""
    from conftest import SHOP, login

    client = APIClient()
    login(client, "9333333333", "Second Vendor")
    r = client.post("/api/v1/vendors", {**SHOP, "shop_name": "Gupta General Store"}, format="json")
    assert r.status_code == 201, r.content
    return client


# --- create -------------------------------------------------------------------------------


def test_create_minimal_listing(vendor_client):
    r = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["name"] == "Fresh Spinach Bundle"
    assert body["category"] == "vegetables"
    assert body["product"] is None
    assert body["availability"] == "in_stock"
    assert body["status"] == "active"
    assert body["source"] == "manual"
    assert body["freshness"] == "fresh"
    assert Decimal(body["price"]) == Decimal("20")


def test_create_with_catalog_product_and_variety(vendor_client):
    variety = ProductVariety.objects.get(product__slug="tomato", name="Hybrid")
    r = vendor_client.post(
        VENDOR_PRODUCTS,
        {
            "category": "vegetables",
            "product": "tomato",
            "variety": str(variety.id),
            "name": "Hybrid Tomato",
            "price": "30",
            "unit": "kg",
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    assert r.json()["product"] == {"slug": "tomato", "name": "Tomato"}
    assert r.json()["variety"] == {"id": str(variety.id), "name": "Hybrid"}


def test_create_rejects_variety_from_a_different_product(vendor_client):
    onion_variety = ProductVariety.objects.filter(product__slug="onion").first()
    if onion_variety is None:
        pytest.skip("no onion variety in taxonomy fixture")
    r = vendor_client.post(
        VENDOR_PRODUCTS,
        {**MINIMAL, "product": "tomato", "variety": str(onion_variety.id)},
        format="json",
    )
    assert r.status_code == 400
    assert "variety" in r.json()["error"]["details"]


def test_create_rejects_category_not_matching_product(vendor_client):
    r = vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "category": "dairy", "product": "tomato"}, format="json")
    assert r.status_code == 400
    assert "category" in r.json()["error"]["details"]


def test_create_rejects_mrp_below_price(vendor_client):
    r = vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "price": "50", "mrp": "40"}, format="json")
    assert r.status_code == 400
    assert "mrp" in r.json()["error"]["details"]


def test_create_rejects_negative_price(vendor_client):
    r = vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "price": "-5"}, format="json")
    assert r.status_code == 400


def test_create_requires_vendor_role(customer):
    api = APIClient()
    api.force_authenticate(customer)
    r = api.post(VENDOR_PRODUCTS, MINIMAL, format="json")
    assert r.status_code == 403


def test_create_requires_auth():
    r = APIClient().post(VENDOR_PRODUCTS, MINIMAL, format="json")
    assert r.status_code == 401


def test_create_files_initial_price_history_and_inventory_event(vendor_client):
    r = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json")
    listing = VendorProduct.objects.get(id=r.json()["id"])
    assert PriceHistory.objects.filter(listing=listing).count() == 1
    assert PriceHistory.objects.get(listing=listing).price == Decimal("20")
    assert InventoryEvent.objects.filter(listing=listing).count() == 1
    assert InventoryEvent.objects.get(listing=listing).availability == VendorProduct.AVAIL_IN_STOCK


def test_duplicate_active_listing_conflicts(vendor_client):
    body = {"category": "vegetables", "product": "tomato", "name": "Tomato", "price": "30", "unit": "kg"}
    r1 = vendor_client.post(VENDOR_PRODUCTS, body, format="json")
    assert r1.status_code == 201
    r2 = vendor_client.post(VENDOR_PRODUCTS, body, format="json")
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "duplicate_listing"


# --- list / detail --------------------------------------------------------------------------


def test_list_only_shows_own_listings(vendor_client):
    vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json")
    other = _second_vendor_client()
    other.post(VENDOR_PRODUCTS, {**MINIMAL, "name": "Other Vendor Item"}, format="json")

    r = vendor_client.get(VENDOR_PRODUCTS)
    names = [item["name"] for item in r.json()["results"]]
    assert "Fresh Spinach Bundle" in names
    assert "Other Vendor Item" not in names


def test_list_default_excludes_deleted(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    vendor_client.delete(f"{VENDOR_PRODUCTS}/{created['id']}")
    r = vendor_client.get(VENDOR_PRODUCTS)
    assert created["id"] not in [item["id"] for item in r.json()["results"]]
    r_deleted = vendor_client.get(VENDOR_PRODUCTS, {"status": "deleted"})
    assert created["id"] in [item["id"] for item in r_deleted.json()["results"]]


def test_list_filters_by_category_and_availability(vendor_client):
    vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json")
    vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "name": "Milk", "category": "dairy"}, format="json")

    r = vendor_client.get(VENDOR_PRODUCTS, {"category": "dairy"})
    names = [item["name"] for item in r.json()["results"]]
    assert names == ["Milk"]

    r2 = vendor_client.get(VENDOR_PRODUCTS, {"availability": "out_of_stock"})
    assert r2.json()["results"] == []


def test_list_requires_vendor_role():
    r = APIClient().get(VENDOR_PRODUCTS)
    assert r.status_code == 401


def test_get_detail_404_for_other_vendors_listing(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    other = _second_vendor_client()
    r = other.get(f"{VENDOR_PRODUCTS}/{created['id']}")
    assert r.status_code == 404


# --- update / delete -------------------------------------------------------------------------


def test_patch_updates_descriptive_fields(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.patch(
        f"{VENDOR_PRODUCTS}/{created['id']}", {"description": "Farm fresh, cut today"}, format="json"
    )
    assert r.status_code == 200
    assert r.json()["description"] == "Farm fresh, cut today"


@pytest.mark.parametrize(
    "field,value,endpoint_hint",
    [("price", "99", "prices"), ("availability", "out_of_stock", "inventory"), ("quantity", "5", "inventory")],
)
def test_patch_rejects_audit_trail_fields(vendor_client, field, value, endpoint_hint):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.patch(f"{VENDOR_PRODUCTS}/{created['id']}", {field: value}, format="json")
    assert r.status_code == 400
    assert endpoint_hint in r.json()["error"]["details"][field][0]


def test_patch_can_pause_and_reactivate(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.patch(f"{VENDOR_PRODUCTS}/{created['id']}", {"status": "paused"}, format="json")
    assert r.status_code == 200
    assert r.json()["status"] == "paused"
    # a paused listing drops out of the default (active+paused... wait, default INCLUDES paused)
    r_list = vendor_client.get(VENDOR_PRODUCTS)
    assert created["id"] in [item["id"] for item in r_list.json()["results"]]

    r2 = vendor_client.patch(f"{VENDOR_PRODUCTS}/{created['id']}", {"status": "active"}, format="json")
    assert r2.json()["status"] == "active"


def test_patch_cannot_set_status_deleted(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.patch(f"{VENDOR_PRODUCTS}/{created['id']}", {"status": "deleted"}, format="json")
    assert r.status_code == 400  # use DELETE instead


def test_delete_soft_deletes(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.delete(f"{VENDOR_PRODUCTS}/{created['id']}")
    assert r.status_code == 204
    listing = VendorProduct.objects.get(id=created["id"])
    assert listing.status == VendorProduct.STATUS_DELETED
    assert PriceHistory.objects.filter(listing=listing).exists()  # history preserved, not cascaded


def test_delete_frees_the_slot_for_a_new_listing(vendor_client):
    body = {"category": "vegetables", "product": "tomato", "name": "Tomato", "price": "30", "unit": "kg"}
    first = vendor_client.post(VENDOR_PRODUCTS, body, format="json").json()
    vendor_client.delete(f"{VENDOR_PRODUCTS}/{first['id']}")
    r = vendor_client.post(VENDOR_PRODUCTS, body, format="json")
    assert r.status_code == 201


# --- inventory --------------------------------------------------------------------------------


def test_inventory_update_changes_state_and_records_event(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.post(
        INVENTORY, {"listing_id": created["id"], "availability": "low_stock", "quantity": "3"}, format="json"
    )
    assert r.status_code == 200
    assert r.json()["availability"] == "low_stock"
    assert Decimal(r.json()["quantity"]) == Decimal("3")
    listing = VendorProduct.objects.get(id=created["id"])
    assert InventoryEvent.objects.filter(listing=listing).count() == 2  # creation + this update


def test_inventory_update_omitted_quantity_keeps_existing(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "quantity": "10"}, format="json").json()
    r = vendor_client.post(INVENTORY, {"listing_id": created["id"], "availability": "out_of_stock"}, format="json")
    assert Decimal(r.json()["quantity"]) == Decimal("10")


def test_inventory_update_idempotent_replay(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    body = {"listing_id": created["id"], "availability": "out_of_stock", "client_mutation_id": "mut-1"}
    r1 = vendor_client.post(INVENTORY, body, format="json")
    r2 = vendor_client.post(INVENTORY, body, format="json")
    assert r1.status_code == r2.status_code == 200
    listing = VendorProduct.objects.get(id=created["id"])
    # creation event + exactly one "mut-1" event, not two
    assert InventoryEvent.objects.filter(listing=listing, client_mutation_id="mut-1").count() == 1


def test_inventory_update_requires_ownership(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    other = _second_vendor_client()
    r = other.post(INVENTORY, {"listing_id": created["id"], "availability": "out_of_stock"}, format="json")
    assert r.status_code == 404


def test_inventory_update_on_deleted_listing_404s(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    vendor_client.delete(f"{VENDOR_PRODUCTS}/{created['id']}")
    r = vendor_client.post(INVENTORY, {"listing_id": created["id"], "availability": "out_of_stock"}, format="json")
    assert r.status_code == 404


# --- prices -----------------------------------------------------------------------------------


def test_price_update_changes_price_and_records_history(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.post(PRICES, {"listing_id": created["id"], "price": "25"}, format="json")
    assert r.status_code == 200
    assert Decimal(r.json()["price"]) == Decimal("25")
    listing = VendorProduct.objects.get(id=created["id"])
    assert PriceHistory.objects.filter(listing=listing).count() == 2  # initial + this change


def test_price_update_same_price_is_a_noop(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    r = vendor_client.post(PRICES, {"listing_id": created["id"], "price": "20"}, format="json")
    assert r.status_code == 200
    listing = VendorProduct.objects.get(id=created["id"])
    assert PriceHistory.objects.filter(listing=listing).count() == 1  # no duplicate entry


def test_price_update_rejects_price_above_mrp(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "price": "20", "mrp": "25"}, format="json").json()
    r = vendor_client.post(PRICES, {"listing_id": created["id"], "price": "30"}, format="json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "price_exceeds_mrp"


def test_price_update_requires_ownership(vendor_client):
    created = vendor_client.post(VENDOR_PRODUCTS, MINIMAL, format="json").json()
    other = _second_vendor_client()
    r = other.post(PRICES, {"listing_id": created["id"], "price": "99"}, format="json")
    assert r.status_code == 404


# --- end-to-end: a vendor-created listing is really findable, not just CRUD-round-trippable ---


def test_created_listing_is_findable_via_public_search(vendor_client):
    vendor_client.post(VENDOR_PRODUCTS, {**MINIMAL, "name": "Rare Herb Bunch"}, format="json")
    r = APIClient().get("/api/v1/search", {"lat": "28.4595", "lng": "77.0266", "q": "Rare Herb Bunch"})
    assert r.status_code == 200
    names = [item["name"] for item in r.json()["results"]]
    assert "Rare Herb Bunch" in names
