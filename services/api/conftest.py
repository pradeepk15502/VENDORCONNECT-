import pytest
from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APIClient

from vc.accounts.models import User


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        call_command("seed_taxonomy", verbosity=0)


@pytest.fixture
def api():
    return APIClient()


def login(api, phone="9876543210", name="Test User", **extra):
    r = api.post("/api/v1/auth/otp/request", {"phone": phone}, format="json")
    assert r.status_code == 200, r.content
    r = api.post(
        "/api/v1/auth/otp/verify", {"phone": phone, "code": r.json()["dev_otp"], "name": name, **extra}, format="json"
    )
    assert r.status_code == 200, r.content
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
    return r


@pytest.fixture
def customer(api, db):
    login(api, "9876543210", "Asha")
    return User.objects.get(phone="+919876543210")


SHOP = {
    "shop_name": "Sharma Vegetable Store",
    "category_slugs": ["vegetables", "fruits"],
    "location": {
        "lat": 28.4595,
        "lng": 77.0266,
        "address_line": "Shop 12, Sector 14 Market",
        "city": "Gurugram",
        "pincode": "122001",
    },
}


@pytest.fixture
def vendor_client(db):
    client = APIClient()
    login(client, "9123456780", "Ramesh Sharma")
    r = client.post("/api/v1/vendors", SHOP, format="json")
    assert r.status_code == 201, r.content
    return client
