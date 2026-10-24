"""Phase 8 — cart (ARCHITECTURE D29). Uses the shared `vendor_client`/`customer` fixtures from the
root conftest, plus `listing`/`open_vendor` from vc/orders/tests/conftest.py."""

from decimal import Decimal

import pytest

from vc.orders.models import CartItem

from .conftest import second_customer_client, vendor_handle

pytestmark = pytest.mark.django_db

CART = "/api/v1/cart"


def test_empty_cart_is_an_empty_list(api, customer):
    r = api.get(CART)
    assert r.status_code == 200
    assert r.json() == []


def test_add_to_cart(api, customer, listing):
    r = api.post(CART, {"listing_id": listing["id"], "quantity": "2"}, format="json")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["listing_id"] == listing["id"]
    assert body["name"] == "Fresh Tomato"
    assert Decimal(body["price"]) == Decimal("40")
    assert Decimal(body["quantity"]) == Decimal("2")
    assert Decimal(body["line_total"]) == Decimal("80")
    assert body["vendor"]["shop_name"] == "Sharma Vegetable Store"
    assert CartItem.objects.count() == 1


def test_adding_the_same_listing_again_increments_quantity_not_a_second_row(api, customer, listing):
    api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    r = api.post(CART, {"listing_id": listing["id"], "quantity": "3"}, format="json")
    assert r.status_code == 200, r.content  # not created — merged into the existing row
    assert Decimal(r.json()["quantity"]) == Decimal("4")
    assert CartItem.objects.count() == 1


def test_cart_price_is_always_live_never_the_price_at_add_time(api, customer, vendor_client, listing):
    api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    price_update = vendor_client.post("/api/v1/prices", {"listing_id": listing["id"], "price": "55"}, format="json")
    assert price_update.status_code == 200, price_update.content

    r = api.get(CART)
    assert Decimal(r.json()[0]["price"]) == Decimal("55")
    assert Decimal(r.json()[0]["line_total"]) == Decimal("55")


def test_out_of_stock_listing_can_still_be_added_but_is_flagged(api, customer, vendor_client, listing):
    vendor_client.post(
        "/api/v1/inventory", {"listing_id": listing["id"], "availability": "out_of_stock"}, format="json"
    )
    r = api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    assert r.status_code == 201, r.content
    assert r.json()["availability"] == "out_of_stock"


def test_a_vendor_cannot_add_their_own_listing_to_cart(vendor_client, listing):
    r = vendor_client.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "cannot_order_own_shop"


def test_adding_an_unknown_listing_is_404(api, customer):
    r = api.post(CART, {"listing_id": "00000000-0000-0000-0000-000000000000", "quantity": "1"}, format="json")
    assert r.status_code == 404


def test_adding_a_deleted_listing_is_404(api, customer, vendor_client, listing):
    vendor_client.delete(f"/api/v1/vendor-products/{listing['id']}")
    r = api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    assert r.status_code == 404


def test_update_quantity(api, customer, cart_with_item):
    item_id = cart_with_item["id"]
    r = api.patch(f"{CART}/items/{item_id}", {"quantity": "5"}, format="json")
    assert r.status_code == 200, r.content
    assert Decimal(r.json()["quantity"]) == Decimal("5")


def test_update_quantity_to_zero_is_rejected(api, customer, cart_with_item):
    r = api.patch(f"{CART}/items/{cart_with_item['id']}", {"quantity": "0"}, format="json")
    assert r.status_code == 400


def test_remove_item(api, customer, cart_with_item):
    r = api.delete(f"{CART}/items/{cart_with_item['id']}")
    assert r.status_code == 204
    assert CartItem.objects.count() == 0


def test_cannot_touch_another_customers_cart_item(api, customer, cart_with_item):
    other = second_customer_client()
    r = other.patch(f"{CART}/items/{cart_with_item['id']}", {"quantity": "9"}, format="json")
    assert r.status_code == 404
    r = other.delete(f"{CART}/items/{cart_with_item['id']}")
    assert r.status_code == 404
    assert CartItem.objects.filter(id=cart_with_item["id"]).exists()


def test_cart_can_hold_items_from_two_different_vendors(api, customer, listing, vendor_client):
    from rest_framework.test import APIClient

    from conftest import SHOP, login

    second_vendor = APIClient()
    login(second_vendor, "9333333333", "Second Vendor")
    r = second_vendor.post("/api/v1/vendors", {**SHOP, "shop_name": "Gupta General Store"}, format="json")
    assert r.status_code == 201, r.content
    listing2 = second_vendor.post(
        "/api/v1/vendor-products",
        {"category": "vegetables", "name": "Onion", "price": "30", "unit": "kg"},
        format="json",
    ).json()

    api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    api.post(CART, {"listing_id": listing2["id"], "quantity": "1"}, format="json")

    body = api.get(CART).json()
    vendors = {row["vendor"]["shop_name"] for row in body}
    assert vendors == {"Sharma Vegetable Store", "Gupta General Store"}


def test_vendor_products_public_listing_for_add_to_cart(api, customer, vendor_client, listing):
    handle = vendor_handle(vendor_client)
    r = api.get(f"/api/v1/vendors/{handle}/products")
    assert r.status_code == 200, r.content
    assert any(p["id"] == listing["id"] for p in r.json()["results"])
    # customer-facing shape never leaks vendor-internal stock counters
    assert "quantity" not in r.json()["results"][0]
    assert "low_stock_threshold" not in r.json()["results"][0]


def test_paused_listing_is_hidden_from_the_public_products_list(api, customer, vendor_client, listing):
    vendor_client.patch(f"/api/v1/vendor-products/{listing['id']}", {"status": "paused"}, format="json")
    handle = vendor_handle(vendor_client)
    r = api.get(f"/api/v1/vendors/{handle}/products")
    assert r.json()["count"] == 0
