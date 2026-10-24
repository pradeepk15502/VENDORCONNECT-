"""Phase 8 — checkout: stock/price revalidation, delivery eligibility, payment states, idempotency
(ARCHITECTURE D29)."""

from decimal import Decimal

import pytest

from vc.orders.models import Order, Payment

pytestmark = pytest.mark.django_db

CART = "/api/v1/cart"
SUMMARY = "/api/v1/checkout/summary"
CHECKOUT = "/api/v1/checkout"


def _expected_items(summary_body):
    return [
        {"listing_id": i["listing_id"], "price": i["price"], "availability": i["availability"]}
        for i in summary_body["items"]
    ]


def _checkout_payload(handle, fulfilment, summary_body, **extra):
    return {
        "vendor": handle,
        "fulfilment": fulfilment,
        "payment_method": "cash",
        "idempotency_key": "test-key-0000001",
        "expected_items": _expected_items(summary_body),
        **extra,
    }


# --- summary -------------------------------------------------------------------------------


def test_summary_requires_address_for_delivery(api, customer, open_vendor, cart_with_item, listing):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    r = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery"})
    assert r.status_code == 400
    assert "address_id" in r.json()["error"]["details"]


def test_summary_pickup_default_shop_is_pickup_only(api, customer, open_vendor, cart_with_item):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    r = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"})
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["pickup_available"] is True
    assert body["delivery_available"] is False
    assert body["can_place_order"] is True
    assert Decimal(body["subtotal"]) == Decimal("80")
    assert Decimal(body["total"]) == Decimal("80")


def test_summary_shop_closed_blocks_order(api, customer, vendor_client, cart_with_item):
    """`cart_with_item` opens the shop via the `open_vendor` fixture chain — reopen-independent
    check: a freshly-created shop starts closed (Phase 5 default) and that alone should block."""
    from .conftest import vendor_handle

    vendor_client.post("/api/v1/vendors/me/status", {"is_open": False}, format="json")
    handle = vendor_handle(vendor_client)
    r = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"})
    assert r.status_code == 200
    assert r.json()["can_place_order"] is False


# --- pickup happy path + shop-closed / empty-cart guards -----------------------------------


def test_checkout_pickup_cash_creates_a_real_order(api, customer, open_vendor, cart_with_item, listing):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["status"] == "placed"
    assert body["fulfilment"] == "pickup"
    assert Decimal(body["subtotal"]) == Decimal("80")
    assert Decimal(body["total"]) == Decimal("80")
    assert body["payment_status"] == "pending"  # cash: collected on handover
    assert body["payment_provider"] == "mock"
    assert len(body["items"]) == 1
    assert body["items"][0]["name"] == "Fresh Tomato"
    assert Decimal(body["items"][0]["unit_price"]) == Decimal("40")
    assert body["events"][0]["status"] == "placed"

    order = Order.objects.get(id=body["id"])
    assert order.number.startswith("VC-")
    # cart is cleared for that vendor once the order is placed
    assert api.get(CART).json() == []


def test_checkout_blocked_when_shop_is_closed(api, customer, vendor_client, cart_with_item, listing):
    from .conftest import vendor_handle

    vendor_client.post("/api/v1/vendors/me/status", {"is_open": False}, format="json")
    handle = vendor_handle(vendor_client)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "vendor_closed"
    assert Order.objects.count() == 0


def test_checkout_empty_cart_is_rejected(api, customer, open_vendor):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "cart_empty"


# --- stock / price revalidation --------------------------------------------------------------


def test_price_change_after_summary_requires_reconfirmation(
    api, customer, vendor_client, open_vendor, cart_with_item, listing
):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    stale_summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()

    vendor_client.post("/api/v1/prices", {"listing_id": listing["id"], "price": "50"}, format="json")

    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", stale_summary), format="json")
    assert r.status_code == 409
    body = r.json()
    assert body["error"]["code"] == "cart_changed"
    change = body["error"]["details"]["changes"][0]
    assert change["field"] == "price" and change["old"] == "40.00" and change["new"] == "50.00"
    assert Order.objects.count() == 0

    # re-fetching the summary and resubmitting (the frontend's actual retry loop) succeeds
    fresh_summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    r2 = api.post(CHECKOUT, _checkout_payload(handle, "pickup", fresh_summary), format="json")
    assert r2.status_code == 201, r2.content
    assert Decimal(r2.json()["items"][0]["unit_price"]) == Decimal("50")


def test_out_of_stock_item_blocks_checkout(api, customer, vendor_client, open_vendor, cart_with_item, listing):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    vendor_client.post(
        "/api/v1/inventory", {"listing_id": listing["id"], "availability": "out_of_stock"}, format="json"
    )

    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "items_unavailable"
    assert Order.objects.count() == 0


def test_insufficient_quantity_blocks_checkout(api, customer, vendor_client, open_vendor, listing):
    from .conftest import vendor_handle

    vendor_client.post(
        "/api/v1/inventory", {"listing_id": listing["id"], "availability": "low_stock", "quantity": "1"}, format="json"
    )
    handle = vendor_handle(open_vendor)
    api.post(CART, {"listing_id": listing["id"], "quantity": "5"}, format="json")  # more than the 1 in stock

    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    assert summary["items"][0]["problem"] == "insufficient_stock"
    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "items_unavailable"


def test_listing_deleted_after_add_to_cart_blocks_checkout(
    api, customer, vendor_client, open_vendor, cart_with_item, listing
):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    vendor_client.delete(f"/api/v1/vendor-products/{listing['id']}")

    r = api.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "items_unavailable"


# --- delivery eligibility (real geography, never client-trusted) ----------------------------


def test_delivery_disabled_by_default(api, customer, open_vendor, cart_with_item, address):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    r = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": address["id"]})
    body = r.json()
    assert body["delivery_eligible"] is False
    assert body["delivery_ineligible_reason"] == "delivery_disabled"

    payload = _checkout_payload(handle, "delivery", body, address_id=address["id"])
    r2 = api.post(CHECKOUT, payload, format="json")
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "delivery_ineligible"


def test_delivery_within_radius_succeeds_with_fee(api, customer, vendor_client, open_vendor, cart_with_item, address):
    from .conftest import vendor_handle

    vendor_client.patch(
        "/api/v1/vendors/me/delivery",
        {"delivery_enabled": True, "radius_km": "5", "delivery_fee": "10", "min_order_amount": "20"},
        format="json",
    )
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": address["id"]}).json()
    assert summary["delivery_eligible"] is True
    assert summary["distance_km"] < 1
    assert Decimal(summary["delivery_fee"]) == Decimal("10")
    assert Decimal(summary["total"]) == Decimal("90")  # 80 subtotal + 10 fee

    payload = _checkout_payload(handle, "delivery", summary, address_id=address["id"])
    r = api.post(CHECKOUT, payload, format="json")
    assert r.status_code == 201, r.content
    order = r.json()
    assert order["fulfilment"] == "delivery"
    assert Decimal(order["delivery_fee"]) == Decimal("10")
    assert Decimal(order["total"]) == Decimal("90")
    assert order["delivery_address"]["city"] == "Gurugram"


def test_delivery_outside_radius_is_rejected(api, customer, vendor_client, open_vendor, cart_with_item, far_address):
    from .conftest import vendor_handle

    vendor_client.patch("/api/v1/vendors/me/delivery", {"delivery_enabled": True, "radius_km": "5"}, format="json")
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": far_address["id"]}).json()
    assert summary["delivery_eligible"] is False
    assert summary["delivery_ineligible_reason"] == "outside_radius"
    assert summary["distance_km"] > 5

    payload = _checkout_payload(handle, "delivery", summary, address_id=far_address["id"])
    r = api.post(CHECKOUT, payload, format="json")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "delivery_ineligible"


def test_delivery_below_minimum_order_is_rejected(api, customer, vendor_client, open_vendor, cart_with_item, address):
    from .conftest import vendor_handle

    vendor_client.patch(
        "/api/v1/vendors/me/delivery", {"delivery_enabled": True, "min_order_amount": "500"}, format="json"
    )
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": address["id"]}).json()
    assert summary["delivery_ineligible_reason"] == "below_minimum"


def test_delivery_free_above_threshold(api, customer, vendor_client, open_vendor, cart_with_item, address):
    from .conftest import vendor_handle

    vendor_client.patch(
        "/api/v1/vendors/me/delivery",
        {"delivery_enabled": True, "delivery_fee": "15", "free_delivery_above": "50"},
        format="json",
    )
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": address["id"]}).json()
    assert Decimal(summary["delivery_fee"]) == Decimal("0")  # subtotal (80) >= free_delivery_above (50)


def test_delivery_requires_an_address_with_a_captured_location(
    api, customer, vendor_client, open_vendor, cart_with_item
):
    from .conftest import vendor_handle

    vendor_client.patch("/api/v1/vendors/me/delivery", {"delivery_enabled": True}, format="json")
    text_only = api.post(
        "/api/v1/addresses",
        {"label": "Home", "line1": "Somewhere", "city": "Gurugram", "pincode": "122001"},
        format="json",
    ).json()
    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": text_only["id"]}).json()
    assert summary["delivery_ineligible_reason"] == "address_missing_location"


# --- payments --------------------------------------------------------------------------------


def test_online_payment_succeeds_by_default(api, customer, open_vendor, cart_with_item):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    payload = _checkout_payload(handle, "pickup", summary, payment_method="online")
    r = api.post(CHECKOUT, payload, format="json")
    assert r.status_code == 201, r.content
    assert r.json()["payment_status"] == "succeeded"
    payment = Payment.objects.get(order_id=r.json()["id"])
    assert payment.provider == "mock" and payment.provider_ref.startswith("mock_")


def test_simulated_payment_failure_creates_no_order(api, customer, open_vendor, cart_with_item):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    payload = _checkout_payload(handle, "pickup", summary, payment_method="online", simulate_failure=True)
    r = api.post(CHECKOUT, payload, format="json")
    assert r.status_code == 402
    assert r.json()["error"]["code"] == "payment_failed"
    assert Order.objects.count() == 0
    assert Payment.objects.count() == 0
    # nothing was consumed — the cart is untouched and the customer can simply retry
    assert len(api.get(CART).json()) == 1


# --- idempotency / duplicate submission -------------------------------------------------------


def test_duplicate_submission_with_the_same_idempotency_key_returns_the_same_order(
    api, customer, open_vendor, cart_with_item
):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    payload = _checkout_payload(handle, "pickup", summary)
    r1 = api.post(CHECKOUT, payload, format="json")
    assert r1.status_code == 201, r1.content

    r2 = api.post(CHECKOUT, payload, format="json")
    assert r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"]
    assert Order.objects.count() == 1


# --- security ----------------------------------------------------------------------------------


def test_checkout_against_an_unknown_vendor_is_404(api, customer):
    r = api.get(SUMMARY, {"vendor": "NOSUCH001", "fulfilment": "pickup"})
    assert r.status_code == 404


def test_vendor_cannot_check_out_their_own_shop(open_vendor, listing):
    from .conftest import vendor_handle

    handle = vendor_handle(open_vendor)
    summary = open_vendor.get(SUMMARY, {"vendor": handle, "fulfilment": "pickup"}).json()
    r = open_vendor.post(CHECKOUT, _checkout_payload(handle, "pickup", summary), format="json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "cannot_order_own_shop"
