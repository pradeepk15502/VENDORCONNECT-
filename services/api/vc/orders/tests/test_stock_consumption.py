"""Phase 12 hardening (docs/ARCHITECTURE.md D33): checkout must actually consume tracked stock, not
just check it. Previously `select_for_update()` correctly re-validated `quantity >= requested` under
a row lock, but nothing ever decremented `VendorProduct.quantity` afterwards — so the lock protected
consistency of the *check*, not the *resource*: two checkouts (concurrent, or just sequential) against
a quantity=1 listing could both pass the same insufficient_stock check and both succeed."""

from decimal import Decimal

import pytest

from vc.catalog.models import InventoryEvent, VendorProduct

from .conftest import second_customer_client, vendor_handle

pytestmark = pytest.mark.django_db

CART = "/api/v1/cart"
SUMMARY = "/api/v1/checkout/summary"
CHECKOUT = "/api/v1/checkout"
INVENTORY = "/api/v1/inventory"


def _set_quantity(vendor_client, listing_id, quantity):
    r = vendor_client.post(
        INVENTORY, {"listing_id": listing_id, "availability": "in_stock", "quantity": quantity}, format="json"
    )
    assert r.status_code == 200, r.content


def _checkout_payload(handle, summary_body, key):
    return {
        "vendor": handle,
        "fulfilment": "pickup",
        "payment_method": "cash",
        "idempotency_key": key,
        "expected_items": [
            {"listing_id": i["listing_id"], "price": i["price"], "availability": i["availability"]}
            for i in summary_body["items"]
        ],
    }


def test_checkout_decrements_tracked_quantity(api, customer, open_vendor, listing, cart_with_item):
    _set_quantity(open_vendor, listing["id"], "5")
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()

    r = api.post(CHECKOUT, _checkout_payload(handle, summary, "stock-key-1"), format="json")
    assert r.status_code == 201, r.content

    updated = VendorProduct.objects.get(id=listing["id"])
    assert updated.quantity == Decimal("3.00")  # 5 - 2 (cart_with_item's quantity)
    assert InventoryEvent.objects.filter(listing=updated, client_mutation_id=f"order:{r.json()['id']}").exists()


def test_second_checkout_is_blocked_once_stock_is_exhausted(api, customer, open_vendor, listing):
    """The real regression: without consuming stock, a second checkout for the same listing used to
    pass the exact same insufficient_stock check the first one did."""
    _set_quantity(open_vendor, listing["id"], "2")
    handle = vendor_handle(open_vendor)

    r = api.post(CART, {"listing_id": listing["id"], "quantity": "2"}, format="json")
    assert r.status_code == 201, r.content
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    first = api.post(CHECKOUT, _checkout_payload(handle, summary, "stock-key-a"), format="json")
    assert first.status_code == 201, first.content
    assert VendorProduct.objects.get(id=listing["id"]).quantity == Decimal("0.00")

    other = second_customer_client()
    other.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    other_summary = other.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    assert other_summary["can_place_order"] is False
    assert other_summary["items"][0]["problem"] == "insufficient_stock"

    second = other.post(CHECKOUT, _checkout_payload(handle, other_summary, "stock-key-b"), format="json")
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "items_unavailable"
    # Confirms the block is real, not just a summary-endpoint quirk: no second order was created.
    from vc.orders.models import Order

    assert Order.objects.filter(vendor__handle=handle).count() == 1


def test_untracked_quantity_listing_is_unaffected_by_checkout(api, customer, open_vendor, listing, cart_with_item):
    """`quantity=None` means the vendor doesn't track a count this way (availability is their only
    signal) — checkout must leave it alone rather than silently starting to track it."""
    assert VendorProduct.objects.get(id=listing["id"]).quantity is None
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()

    r = api.post(CHECKOUT, _checkout_payload(handle, summary, "stock-key-untracked"), format="json")
    assert r.status_code == 201, r.content
    assert VendorProduct.objects.get(id=listing["id"]).quantity is None
