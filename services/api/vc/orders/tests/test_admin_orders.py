"""Phase 11 — admin order visibility (master prompt §23): read-only cross-vendor/cross-customer
order list + detail for staff. No refund/payment action lives here — `_settle_payment` (checkout
and transition flows) is the only writer of `Payment` rows, unchanged by this phase."""

import pytest
from rest_framework.test import APIClient

from vc.accounts.models import User

from .test_orders import _place_order

pytestmark = pytest.mark.django_db

ORDERS = "/api/v1/admin/orders"
_PASSWORD = "correct-horse-battery-staple"


def _admin_session(user, password: str = _PASSWORD) -> APIClient:
    client = APIClient()
    r = client.post("/api/v1/auth/admin/password", {"phone": user.phone, "password": password}, format="json")
    assert r.status_code == 200, r.content
    r2 = client.post(
        "/api/v1/auth/otp/verify", {"phone": user.phone, "code": r.json()["dev_otp"], "purpose": "admin"}, format="json"
    )
    assert r2.status_code == 200, r2.content
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r2.json()['access']}")
    return client


def _superuser_login(phone: str, password: str = _PASSWORD):
    user = User.objects.create_superuser(phone, password)
    return _admin_session(user, password), user


def _staff_login(phone: str, roles, password: str = _PASSWORD):
    user = User.objects.create_user(phone, password, roles=list(roles))
    return _admin_session(user, password), user


# --- authorization ---------------------------------------------------------------------------


def test_customer_cannot_list_admin_orders(api, customer):
    assert api.get(ORDERS).status_code == 403


def test_vendor_cannot_list_admin_orders(vendor_client):
    assert vendor_client.get(ORDERS).status_code == 403


def test_staff_role_alone_can_list_admin_orders(customer):
    staff, _ = _staff_login("+919888400001", roles=("support",))
    assert staff.get(ORDERS).status_code == 200  # IsStaffRole only — read-only, no fine-grained perm needed


# --- listing / search / filter -----------------------------------------------------------------


def test_admin_sees_orders_across_vendors_and_customers(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    handle = open_vendor.get("/api/v1/vendors/me").json()["handle"]
    superuser, _ = _superuser_login("+919888400002")

    r = superuser.get(ORDERS)
    assert r.status_code == 200, r.content
    row = next(o for o in r.json()["results"] if o["id"] == order["id"])
    assert row["customer_name"] == "Asha"
    assert row["vendor_handle"].lower() == handle.lower()
    assert row["vendor_shop_name"] == "Sharma Vegetable Store"
    assert row["fulfilment"] == "pickup"
    assert row["status"] == "placed"
    assert row["payment_status"] in ("succeeded", "pending")
    assert "total" in row and "number" in row


def test_admin_can_search_orders_by_number_customer_or_vendor(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    handle = open_vendor.get("/api/v1/vendors/me").json()["handle"]
    superuser, _ = _superuser_login("+919888400003")

    by_number = superuser.get(ORDERS, {"q": order["number"]})
    assert any(o["id"] == order["id"] for o in by_number.json()["results"])

    by_customer = superuser.get(ORDERS, {"q": "Asha"})
    assert any(o["id"] == order["id"] for o in by_customer.json()["results"])

    by_vendor = superuser.get(ORDERS, {"q": handle})
    assert any(o["id"] == order["id"] for o in by_vendor.json()["results"])

    no_match = superuser.get(ORDERS, {"q": "no-such-order-xyz"})
    assert no_match.json()["count"] == 0


def test_admin_can_filter_orders_by_status_and_fulfilment(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    superuser, _ = _superuser_login("+919888400004")

    by_status = superuser.get(ORDERS, {"status": "placed"})
    assert any(o["id"] == order["id"] for o in by_status.json()["results"])

    wrong_status = superuser.get(ORDERS, {"status": "completed"})
    assert not any(o["id"] == order["id"] for o in wrong_status.json()["results"])

    by_fulfilment = superuser.get(ORDERS, {"fulfilment": "pickup"})
    assert any(o["id"] == order["id"] for o in by_fulfilment.json()["results"])

    wrong_fulfilment = superuser.get(ORDERS, {"fulfilment": "delivery"})
    assert not any(o["id"] == order["id"] for o in wrong_fulfilment.json()["results"])


# --- detail ------------------------------------------------------------------------------------


def test_admin_order_detail_shows_full_timeline_without_customer_phone(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    superuser, _ = _superuser_login("+919888400005")

    r = superuser.get(f"{ORDERS}/{order['id']}")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["id"] == order["id"]
    assert body["customer"]["name"] == "Asha"
    assert "phone" not in body["customer"]
    assert len(body["items"]) == 1
    assert body["events"][0]["status"] == "placed"


def test_admin_order_detail_404_for_unknown_id(customer):
    superuser, _ = _superuser_login("+919888400006")
    r = superuser.get(f"{ORDERS}/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# --- read-only: no write/refund capability ------------------------------------------------------


def test_admin_order_endpoints_are_read_only(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing)
    superuser, _ = _superuser_login("+919888400007")

    assert superuser.post(ORDERS, {}, format="json").status_code == 405
    assert superuser.patch(f"{ORDERS}/{order['id']}", {}, format="json").status_code == 405
    assert superuser.delete(f"{ORDERS}/{order['id']}").status_code == 405
