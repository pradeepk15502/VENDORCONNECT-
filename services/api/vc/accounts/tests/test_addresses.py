"""Phase 8 — saved customer addresses (ARCHITECTURE D29)."""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

ADDRESSES = "/api/v1/addresses"


def test_first_address_becomes_default_automatically(api, customer):
    r = api.post(
        ADDRESSES, {"label": "Home", "line1": "House 4", "city": "Gurugram", "pincode": "122001"}, format="json"
    )
    assert r.status_code == 201, r.content
    assert r.json()["is_default"] is True
    assert r.json()["lat"] is None and r.json()["lng"] is None


def test_address_with_a_captured_location(api, customer):
    r = api.post(
        ADDRESSES,
        {"label": "Home", "line1": "House 4", "city": "Gurugram", "pincode": "122001", "lat": 28.4595, "lng": 77.0266},
        format="json",
    )
    assert r.status_code == 201, r.content
    assert r.json()["lat"] == pytest.approx(28.4595)
    assert r.json()["lng"] == pytest.approx(77.0266)


def test_lat_without_lng_is_rejected(api, customer):
    r = api.post(
        ADDRESSES, {"label": "Home", "line1": "X", "city": "Gurugram", "pincode": "122001", "lat": 28.4}, format="json"
    )
    assert r.status_code == 400


def test_setting_a_second_address_as_default_unsets_the_first(api, customer):
    first = api.post(
        ADDRESSES, {"label": "Home", "line1": "A", "city": "Gurugram", "pincode": "122001"}, format="json"
    ).json()
    second = api.post(
        ADDRESSES,
        {"label": "Office", "line1": "B", "city": "Gurugram", "pincode": "122002", "is_default": True},
        format="json",
    ).json()
    assert second["is_default"] is True
    assert api.get(f"{ADDRESSES}/{first['id']}").json()["is_default"] is False


def test_patch_can_promote_an_address_to_default(api, customer):
    first = api.post(
        ADDRESSES, {"label": "Home", "line1": "A", "city": "Gurugram", "pincode": "122001"}, format="json"
    ).json()
    second = api.post(
        ADDRESSES, {"label": "Office", "line1": "B", "city": "Gurugram", "pincode": "122002"}, format="json"
    ).json()
    assert second["is_default"] is False

    r = api.patch(f"{ADDRESSES}/{second['id']}", {"is_default": True}, format="json")
    assert r.status_code == 200 and r.json()["is_default"] is True
    assert api.get(f"{ADDRESSES}/{first['id']}").json()["is_default"] is False


def test_deleting_the_default_promotes_another(api, customer):
    first = api.post(
        ADDRESSES, {"label": "Home", "line1": "A", "city": "Gurugram", "pincode": "122001"}, format="json"
    ).json()
    second = api.post(
        ADDRESSES, {"label": "Office", "line1": "B", "city": "Gurugram", "pincode": "122002"}, format="json"
    ).json()
    assert first["is_default"] is True

    r = api.delete(f"{ADDRESSES}/{first['id']}")
    assert r.status_code == 204
    assert api.get(f"{ADDRESSES}/{second['id']}").json()["is_default"] is True


def test_list_orders_default_first(api, customer):
    api.post(ADDRESSES, {"label": "Home", "line1": "A", "city": "Gurugram", "pincode": "122001"}, format="json")
    second = api.post(
        ADDRESSES,
        {"label": "Office", "line1": "B", "city": "Gurugram", "pincode": "122002", "is_default": True},
        format="json",
    ).json()
    r = api.get(ADDRESSES)
    assert r.json()[0]["id"] == second["id"]


def test_cannot_access_another_customers_address(api, customer):
    from conftest import login

    mine = api.post(
        ADDRESSES, {"label": "Home", "line1": "A", "city": "Gurugram", "pincode": "122001"}, format="json"
    ).json()
    other = APIClient()
    login(other, "9555555555", "Bina")
    assert other.get(f"{ADDRESSES}/{mine['id']}").status_code == 404
    assert other.patch(f"{ADDRESSES}/{mine['id']}", {"label": "Hacked"}, format="json").status_code == 404
    assert other.delete(f"{ADDRESSES}/{mine['id']}").status_code == 404


def test_unauthenticated_request_is_rejected(db):
    r = APIClient().get(ADDRESSES)
    assert r.status_code == 401
