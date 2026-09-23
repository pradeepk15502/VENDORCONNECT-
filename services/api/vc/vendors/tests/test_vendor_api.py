import copy

import pytest
from rest_framework.test import APIClient

from conftest import SHOP, login
from vc.vendors.models import Vendor

pytestmark = pytest.mark.django_db


def test_create_shop_issues_vendor_id_and_role(vendor_client):
    r = vendor_client.get("/api/v1/vendors/me")
    assert r.status_code == 200
    v = r.json()
    assert v["handle"] == "SHARMA001" and v["vendor_id"] == "@SHARMA001"
    assert v["is_open"] is False and v["verified"] is False
    assert v["delivery"]["delivery_enabled"] is False and v["delivery"]["pickup_enabled"] is True
    me = vendor_client.get("/api/v1/auth/me").json()
    assert "vendor" in me["roles"] and me["vendor"]["handle"] == "SHARMA001"


def test_second_sharma_gets_next_number(vendor_client):
    c = APIClient()
    login(c, "9123456781")
    r = c.post("/api/v1/vendors", SHOP, format="json")
    assert r.json()["handle"] == "SHARMA002"


def test_cannot_create_two_shops(vendor_client):
    assert vendor_client.post("/api/v1/vendors", SHOP, format="json").status_code == 409


def test_validation(customer, api):
    bad = copy.deepcopy(SHOP)
    bad["category_slugs"] = ["not-a-category"]
    bad["location"]["lat"] = 51.5  # London, outside India
    r = api.post("/api/v1/vendors", bad, format="json")
    assert r.status_code == 400
    d = r.json()["error"]["details"]
    assert "category_slugs" in d and "location" in d


@pytest.mark.parametrize("handle", ["SHARMA001", "sharma001", "@sharma001", "@ShArMa001"])
def test_public_lookup_case_insensitive(vendor_client, handle):
    r = APIClient().get(f"/api/v1/vendors/{handle}")
    assert r.status_code == 200
    body = r.json()
    assert body["shop_name"] == "Sharma Vegetable Store"
    assert "owner" not in body and "status" not in body


def test_open_close_toggle_visible_to_customers(vendor_client):
    r = vendor_client.post("/api/v1/vendors/me/status", {"is_open": True}, format="json")
    assert r.status_code == 200 and r.json()["is_open"] is True
    assert APIClient().get("/api/v1/vendors/@SHARMA001").json()["is_open"] is True
    vendor_client.post("/api/v1/vendors/me/status", {"is_open": False}, format="json")
    assert APIClient().get("/api/v1/vendors/@SHARMA001").json()["is_open"] is False


def test_customer_cannot_use_vendor_endpoints(customer, api):
    assert api.post("/api/v1/vendors/me/status", {"is_open": True}, format="json").status_code == 403


def test_delivery_settings(vendor_client):
    r = vendor_client.patch(
        "/api/v1/vendors/me/delivery",
        {"delivery_enabled": True, "radius_km": "4.5", "delivery_fee": "20"},
        format="json",
    )
    assert r.status_code == 200 and r.json()["delivery_enabled"] is True
    r = vendor_client.patch(
        "/api/v1/vendors/me/delivery", {"delivery_enabled": False, "pickup_enabled": False}, format="json"
    )
    assert r.status_code == 400
    r = vendor_client.patch("/api/v1/vendors/me/delivery", {"radius_km": "80"}, format="json")
    assert r.status_code == 400


def test_rename_keeps_handle(vendor_client):
    r = vendor_client.patch(
        "/api/v1/vendors/me", {"shop_name": "Sharma Fresh Mart", "handle": "HACK001"}, format="json"
    )
    assert r.status_code == 200
    assert r.json()["handle"] == "SHARMA001" and r.json()["shop_name"] == "Sharma Fresh Mart"


def test_suspended_vendor_hidden(vendor_client):
    Vendor.objects.filter(handle="SHARMA001").update(status=Vendor.STATUS_SUSPENDED)
    assert APIClient().get("/api/v1/vendors/@SHARMA001").status_code == 404
