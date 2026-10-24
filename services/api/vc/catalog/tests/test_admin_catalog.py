"""Phase 11 — admin catalog visibility (master prompt §10): every vendor's listings across the
platform, plus a real-usage-count taxonomy view. Both read-only — no admin endpoint here writes to
a vendor's own price/stock (that stays exclusively `PriceView`/`InventoryView`, vendor-only)."""

import pytest
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.catalog.models import VendorProduct

pytestmark = pytest.mark.django_db

PRODUCTS = "/api/v1/admin/products"
CATEGORIES = "/api/v1/admin/categories"
_PASSWORD = "correct-horse-battery-staple"


def _superuser_client(phone: str) -> APIClient:
    User.objects.create_superuser(phone, _PASSWORD)
    client = APIClient()
    r = client.post("/api/v1/auth/admin/password", {"phone": phone, "password": _PASSWORD}, format="json")
    assert r.status_code == 200, r.content
    r2 = client.post(
        "/api/v1/auth/otp/verify", {"phone": phone, "code": r.json()["dev_otp"], "purpose": "admin"}, format="json"
    )
    assert r2.status_code == 200, r2.content
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r2.json()['access']}")
    return client


def _add_listing(vendor_client, name="Fresh Tomato", price="40", category="vegetables"):
    r = vendor_client.post(
        "/api/v1/vendor-products", {"category": category, "name": name, "price": price, "unit": "kg"}, format="json"
    )
    assert r.status_code == 201, r.content
    return r.json()


# --- authorization ---------------------------------------------------------------------------


def test_customer_cannot_list_admin_products(api, customer):
    assert api.get(PRODUCTS).status_code == 403


def test_vendor_cannot_list_admin_products(vendor_client):
    assert vendor_client.get(PRODUCTS).status_code == 403


# --- listing / search / filter -----------------------------------------------------------------


def test_admin_sees_listings_across_vendors(vendor_client):
    listing = _add_listing(vendor_client)
    admin = _superuser_client("+919888300001")
    r = admin.get(PRODUCTS)
    assert r.status_code == 200, r.content
    assert any(p["id"] == listing["id"] for p in r.json()["results"])


def test_admin_can_search_filter_by_category_vendor_status(vendor_client):
    listing = _add_listing(vendor_client, name="Unique Brinjal 42")
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    admin = _superuser_client("+919888300002")

    by_name = admin.get(PRODUCTS, {"q": "Unique Brinjal"})
    assert any(p["id"] == listing["id"] for p in by_name.json()["results"])

    by_vendor = admin.get(PRODUCTS, {"vendor": handle})
    assert any(p["id"] == listing["id"] for p in by_vendor.json()["results"])

    by_category = admin.get(PRODUCTS, {"category": "vegetables"})
    assert any(p["id"] == listing["id"] for p in by_category.json()["results"])

    wrong_category = admin.get(PRODUCTS, {"category": "dairy"})
    assert not any(p["id"] == listing["id"] for p in wrong_category.json()["results"])


def test_deleted_listings_excluded_by_default_but_visible_with_explicit_filter(vendor_client):
    listing = _add_listing(vendor_client, name="Soon Deleted Item")
    vendor_client.delete(f"/api/v1/vendor-products/{listing['id']}")
    admin = _superuser_client("+919888300003")

    default_view = admin.get(PRODUCTS)
    assert not any(p["id"] == listing["id"] for p in default_view.json()["results"])

    explicit = admin.get(PRODUCTS, {"status": "deleted"})
    assert any(p["id"] == listing["id"] for p in explicit.json()["results"])


def test_admin_listing_view_never_writes_vendor_price_or_stock(vendor_client):
    listing = _add_listing(vendor_client)
    admin = _superuser_client("+919888300004")
    admin.get(PRODUCTS)  # a GET only
    still = VendorProduct.objects.get(id=listing["id"])
    assert str(still.price) == "40.00"
    assert still.availability == VendorProduct.AVAIL_IN_STOCK


# --- categories --------------------------------------------------------------------------------


def test_admin_categories_include_real_usage_counts(vendor_client):
    _add_listing(vendor_client)
    admin = _superuser_client("+919888300005")
    r = admin.get(CATEGORIES)
    assert r.status_code == 200, r.content
    veg = next(c for c in r.json() if c["slug"] == "vegetables")
    assert veg["listing_count"] >= 1
    assert veg["vendor_count"] >= 1


def test_customer_cannot_list_admin_categories(api, customer):
    assert api.get(CATEGORIES).status_code == 403
