"""Phase 8 — order permissions, status transitions and cancellation (ARCHITECTURE D29)."""

import pytest

from vc.notifications.models import Notification
from vc.orders.models import Order, Payment

from .conftest import second_customer_client, vendor_handle

pytestmark = pytest.mark.django_db

CART = "/api/v1/cart"
SUMMARY = "/api/v1/checkout/summary"
CHECKOUT = "/api/v1/checkout"
ORDERS = "/api/v1/orders"


def _place_order(api, open_vendor, listing, fulfilment="pickup", payment_method="cash", key="idem-key-0001"):
    handle = vendor_handle(open_vendor)
    api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": fulfilment}).json()
    payload = {
        "vendor": handle,
        "fulfilment": fulfilment,
        "payment_method": payment_method,
        "idempotency_key": key,
        "expected_items": [
            {"listing_id": i["listing_id"], "price": i["price"], "availability": i["availability"]}
            for i in summary["items"]
        ],
    }
    r = api.post(CHECKOUT, payload, format="json")
    assert r.status_code == 201, r.content
    return r.json()


def _transition(client, order_id, action, **extra):
    return client.post(f"{ORDERS}/{order_id}/transition", {"action": action, **extra}, format="json")


# --- listing / detail / cross-account security -----------------------------------------------


def test_customer_sees_their_own_order_in_the_list_and_detail(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = api.get(ORDERS, {"role": "customer"})
    assert r.status_code == 200
    assert [o["id"] for o in r.json()["results"]] == [order["id"]]

    r2 = api.get(f"{ORDERS}/{order['id']}")
    assert r2.status_code == 200 and r2.json()["id"] == order["id"]


def test_vendor_sees_the_order_in_their_own_list(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = open_vendor.get(ORDERS, {"role": "vendor"})
    assert [o["id"] for o in r.json()["results"]] == [order["id"]]
    # the vendor never sees the customer's phone number (same D14 rule chat already enforces)
    assert "phone" not in r.json()["results"][0]["customer"]


def test_another_customer_cannot_view_this_order(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    other = second_customer_client()
    r = other.get(f"{ORDERS}/{order['id']}")
    assert r.status_code == 403


def test_another_vendor_cannot_view_or_act_on_this_order(api, customer, open_vendor, listing):
    from rest_framework.test import APIClient

    from conftest import SHOP, login

    order = _place_order(api, open_vendor, listing)
    other_vendor = APIClient()
    login(other_vendor, "9444444444", "Other Vendor")
    other_vendor.post("/api/v1/vendors", {**SHOP, "shop_name": "Other Shop"}, format="json")

    assert other_vendor.get(f"{ORDERS}/{order['id']}").status_code == 403
    assert _transition(other_vendor, order["id"], "accept").status_code == 403
    assert Order.objects.get(id=order["id"]).status == "placed"


def test_unknown_order_id_is_404(api, customer):
    r = api.get(f"{ORDERS}/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# --- state machine -----------------------------------------------------------------------------


def test_full_pickup_lifecycle_and_notifications(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing, fulfilment="pickup")
    oid = order["id"]
    assert Notification.objects.filter(kind="new_order").exists()

    for action, expected_status in [
        ("accept", "accepted"),
        ("preparing", "preparing"),
        ("ready", "ready"),
        ("picked_up", "picked_up"),
        ("completed", "completed"),
    ]:
        r = _transition(open_vendor, oid, action)
        assert r.status_code == 200, (action, r.content)
        assert r.json()["status"] == expected_status

    order_row = Order.objects.get(id=oid)
    assert order_row.events.count() == 6  # placed + 5 transitions
    # cash is only "collected" once the order is actually complete
    assert Payment.objects.get(order=order_row).status == "succeeded"
    customer_notifications = set(Notification.objects.filter(user=order_row.customer).values_list("title", flat=True))
    assert {"Order accepted", "Order ready", "Order completed"} <= customer_notifications


def test_full_delivery_lifecycle(api, customer, vendor_client, open_vendor, listing, address):
    vendor_client.patch("/api/v1/vendors/me/delivery", {"delivery_enabled": True}, format="json")
    handle = vendor_handle(open_vendor)
    api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": address["id"]}).json()
    payload = {
        "vendor": handle,
        "fulfilment": "delivery",
        "address_id": address["id"],
        "payment_method": "cash",
        "idempotency_key": "k-delivery",
        "expected_items": [
            {"listing_id": i["listing_id"], "price": i["price"], "availability": i["availability"]}
            for i in summary["items"]
        ],
    }
    order = api.post(CHECKOUT, payload, format="json").json()
    oid = order["id"]

    for action, expected_status in [
        ("accept", "accepted"),
        ("preparing", "preparing"),
        ("ready", "ready"),
        ("out_for_delivery", "out_for_delivery"),
        ("delivered", "delivered"),
        ("completed", "completed"),
    ]:
        r = _transition(open_vendor, oid, action)
        assert r.status_code == 200, (action, r.content)
        assert r.json()["status"] == expected_status


def test_picked_up_is_invalid_for_a_delivery_order(api, customer, vendor_client, open_vendor, listing, address):
    vendor_client.patch("/api/v1/vendors/me/delivery", {"delivery_enabled": True}, format="json")
    handle = vendor_handle(open_vendor)
    api.post(CART, {"listing_id": listing["id"], "quantity": "1"}, format="json")
    summary = api.get(SUMMARY, {"vendor": handle, "fulfilment": "delivery", "address_id": address["id"]}).json()
    payload = {
        "vendor": handle,
        "fulfilment": "delivery",
        "address_id": address["id"],
        "payment_method": "cash",
        "idempotency_key": "idem-key-0002",
        "expected_items": [
            {"listing_id": i["listing_id"], "price": i["price"], "availability": i["availability"]}
            for i in summary["items"]
        ],
    }
    order = api.post(CHECKOUT, payload, format="json").json()
    _transition(open_vendor, order["id"], "accept")
    _transition(open_vendor, order["id"], "preparing")
    _transition(open_vendor, order["id"], "ready")
    r = _transition(open_vendor, order["id"], "picked_up")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "invalid_transition"


def test_reject_requires_a_reason(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = _transition(open_vendor, order["id"], "reject")
    assert r.status_code == 400
    assert "reason" in r.json()["error"]["details"]


def test_rejected_order_cannot_become_preparing(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = _transition(open_vendor, order["id"], "reject", reason="Out of stock, sorry.")
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    r2 = _transition(open_vendor, order["id"], "preparing")
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "invalid_transition"
    assert Order.objects.get(id=order["id"]).rejection_reason == "Out of stock, sorry."


def test_completed_order_cannot_become_preparing(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    for action in ("accept", "preparing", "ready", "picked_up", "completed"):
        assert _transition(open_vendor, order["id"], action).status_code == 200
    r = _transition(open_vendor, order["id"], "preparing")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "invalid_transition"


def test_customer_cannot_perform_vendor_actions(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = _transition(api, order["id"], "accept")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "permission_denied"


def test_vendor_cannot_cancel(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = _transition(open_vendor, order["id"], "cancel")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "permission_denied"


# --- cancellation --------------------------------------------------------------------------------


def test_customer_can_cancel_before_acceptance(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    r = _transition(api, order["id"], "cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert Notification.objects.filter(kind="order_status", title="Order cancelled").exists()


def test_customer_cannot_cancel_after_vendor_accepts(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    _transition(open_vendor, order["id"], "accept")
    r = _transition(api, order["id"], "cancel")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "invalid_transition"


def test_cancelling_a_prepaid_online_order_marks_the_payment_refunded(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing, payment_method="online", key="k-online")
    assert order["payment_status"] == "succeeded"
    r = _transition(api, order["id"], "cancel")
    assert r.status_code == 200
    assert Payment.objects.get(order_id=order["id"]).status == "refunded"


def test_rejecting_a_cash_order_leaves_the_never_collected_payment_failed(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing, payment_method="cash")
    _transition(open_vendor, order["id"], "reject", reason="Can't fulfil this today.")
    assert Payment.objects.get(order_id=order["id"]).status == "failed"
