"""Shared fixtures for Phase 8 (cart/checkout/orders) tests."""

import pytest
from rest_framework.test import APIClient

VENDOR_PRODUCTS = "/api/v1/vendor-products"
CART = "/api/v1/cart"


def vendor_handle(vendor_client) -> str:
    return vendor_client.get("/api/v1/vendors/me").json()["handle"]


def open_shop(vendor_client):
    r = vendor_client.post("/api/v1/vendors/me/status", {"is_open": True}, format="json")
    assert r.status_code == 200, r.content


def second_customer_client() -> APIClient:
    from conftest import login

    client = APIClient()
    login(client, "9555555555", "Bina")
    return client


@pytest.fixture
def listing(vendor_client):
    """One active, in-stock listing (₹40/kg) on `vendor_client`'s shop."""
    r = vendor_client.post(
        VENDOR_PRODUCTS, {"category": "vegetables", "name": "Fresh Tomato", "price": "40", "unit": "kg"}, format="json"
    )
    assert r.status_code == 201, r.content
    return r.json()


@pytest.fixture
def open_vendor(vendor_client):
    """`vendor_client`, but the shop is open (a fresh shop starts closed — Phase 5 default)."""
    open_shop(vendor_client)
    return vendor_client


@pytest.fixture
def cart_with_item(api, customer, open_vendor, listing):
    """`api` (the `customer` fixture's client) with one unit of `listing` already in the cart."""
    r = api.post(CART, {"listing_id": listing["id"], "quantity": "2"}, format="json")
    assert r.status_code == 201, r.content
    return r.json()


@pytest.fixture
def address(api, customer):
    """A default address for the customer, right at the seeded shop's own coordinates (Gurugram) —
    well within any reasonable delivery radius."""
    r = api.post(
        "/api/v1/addresses",
        {
            "label": "Home",
            "line1": "House 4, Sector 14",
            "city": "Gurugram",
            "pincode": "122001",
            "lat": 28.4595,
            "lng": 77.0266,
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    return r.json()


@pytest.fixture
def far_address(api, customer):
    """An address far from the seeded shop (central Delhi, ~19 km away) — outside any default
    delivery radius, for the "customer outside delivery radius" edge case."""
    r = api.post(
        "/api/v1/addresses",
        {
            "label": "Office",
            "line1": "Connaught Place",
            "city": "New Delhi",
            "pincode": "110001",
            "lat": 28.6139,
            "lng": 77.2090,
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    return r.json()
