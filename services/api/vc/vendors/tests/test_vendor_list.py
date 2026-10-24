"""GET /vendors — nearby vendor discovery (Phase 3, ARCHITECTURE D22)."""

from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.catalog.models import Category
from vc.core.geo import make_point
from vc.vendors.handles import create_vendor_with_handle
from vc.vendors.models import DeliverySettings, Vendor, VendorLocation, VendorProfile

pytestmark = pytest.mark.django_db

GURUGRAM = {"lat": 28.4595, "lng": 77.0266}
VENDORS = "/api/v1/vendors"


def make_vendor(shop_name, lat, lng, *, category="vegetables", is_open=True, phone):
    user = User.objects.create_user(phone=phone, roles=("customer",))
    vendor = create_vendor_with_handle(owner=user, shop_name=shop_name, public_phone=phone)
    vendor.categories.set(Category.objects.filter(slug=category))
    VendorProfile.objects.create(vendor=vendor, bio="")
    VendorLocation.objects.create(vendor=vendor, point=make_point(lat, lng), address_line="Shop", city="Gurugram")
    DeliverySettings.objects.create(vendor=vendor)
    if is_open:
        vendor.is_open, vendor.status_changed_at = True, timezone.now()
        vendor.save(update_fields=["is_open", "status_changed_at"])
    user.add_role("vendor")
    return vendor


@pytest.fixture
def near(db):
    """~50 m from Gurugram centre, open."""
    return make_vendor("Sharma Vegetable Store", 28.4598, 77.0270, phone="+919000000201")


@pytest.fixture
def far(db):
    """~7.8 km north of Gurugram centre, open — outside the default 5 km radius."""
    return make_vendor("Far Vegetable Store", 28.5295, 77.0266, phone="+919000000202")


def test_default_radius_excludes_far_vendor(near, far):
    r = APIClient().get(VENDORS, GURUGRAM)
    assert r.status_code == 200
    names = [v["shop_name"] for v in r.json()["results"]]
    assert names == ["Sharma Vegetable Store"]


def test_wider_radius_includes_far_vendor_ranked_after_near_one(near, far):
    r = APIClient().get(VENDORS, {**GURUGRAM, "radius_km": 10})
    assert r.status_code == 200
    names = [v["shop_name"] for v in r.json()["results"]]
    assert names == ["Sharma Vegetable Store", "Far Vegetable Store"]
    assert r.json()["results"][0]["distance_km"] < r.json()["results"][1]["distance_km"]


def test_open_vendors_ranked_before_closed_regardless_of_distance():
    make_vendor("Closed Nearby", 28.4598, 77.0270, is_open=False, phone="+919000000203")
    make_vendor("Open Farther", 28.4650, 77.0270, is_open=True, phone="+919000000204")
    r = APIClient().get(VENDORS, {**GURUGRAM, "radius_km": 10})
    names = [v["shop_name"] for v in r.json()["results"]]
    assert names == ["Open Farther", "Closed Nearby"]
    assert r.json()["results"][0]["is_open"] is True
    assert r.json()["results"][1]["is_open"] is False


def test_category_filter():
    make_vendor("Veg Shop", 28.4598, 77.0270, category="vegetables", phone="+919000000205")
    make_vendor("Fruit Shop", 28.4599, 77.0271, category="fruits", phone="+919000000206")
    r = APIClient().get(VENDORS, {**GURUGRAM, "category": "fruits"})
    names = [v["shop_name"] for v in r.json()["results"]]
    assert names == ["Fruit Shop"]


def test_suspended_vendor_excluded(near):
    near.status = Vendor.STATUS_SUSPENDED
    near.save(update_fields=["status"])
    r = APIClient().get(VENDORS, GURUGRAM)
    assert r.json()["results"] == []


def test_pagination():
    for i in range(25):
        make_vendor(f"Shop {i}", 28.4598, 77.0270, phone=f"+9190000003{i:02d}")
    r = APIClient().get(VENDORS, GURUGRAM)
    body = r.json()
    assert body["count"] == 25 and len(body["results"]) == 20 and body["next"] is not None
    r2 = APIClient().get(VENDORS, {**GURUGRAM, "page": 2})
    assert len(r2.json()["results"]) == 5 and r2.json()["previous"] is not None


def test_result_shape(near):
    body = APIClient().get(VENDORS, GURUGRAM).json()["results"][0]
    assert body["handle"] == near.handle
    assert body["vendor_id"] == f"@{near.handle}"
    assert body["shop_name"] == "Sharma Vegetable Store"
    assert body["verified"] is False
    assert body["is_open"] is True
    assert isinstance(body["distance_km"], float)
    assert body["categories"] == ["vegetables"]
    assert body["location"]["city"] == "Gurugram"
    assert body["delivery"]["pickup_enabled"] is True
    assert "owner" not in body


@pytest.mark.parametrize(
    "params,field",
    [
        ({"lng": 77.0266}, "lat"),
        ({"lat": 28.4595}, "lng"),
        ({**GURUGRAM, "lat": 51.5}, "lat"),  # London, outside India bounds
        ({**GURUGRAM, "category": "not-a-category"}, "category"),
        ({**GURUGRAM, "radius_km": 100}, "radius_km"),  # above SEARCH_RADIUS_KM_MAX
        ({**GURUGRAM, "radius_km": 0.1}, "radius_km"),
    ],
)
def test_validation_errors(params, field):
    r = APIClient().get(VENDORS, params)
    assert r.status_code == 400
    assert field in r.json()["error"]["details"]


def test_no_auth_required(near):
    r = APIClient().get(VENDORS, GURUGRAM)
    assert r.status_code == 200


def test_create_still_works_on_same_collection_endpoint(customer, api):
    from conftest import SHOP

    r = api.post(VENDORS, SHOP, format="json")
    assert r.status_code == 201
    assert r.json()["shop_name"] == "Sharma Vegetable Store"


def test_list_requires_no_auth_even_though_create_does():
    assert APIClient().post(VENDORS, {}, format="json").status_code == 401


def test_decimal_prices_untouched_by_list_serializer(near):
    """Sanity: DeliverySettings decimals still serialize cleanly through VendorListSerializer."""
    near.delivery.delivery_fee = Decimal("15.50")
    near.delivery.save(update_fields=["delivery_fee"])
    body = APIClient().get(VENDORS, GURUGRAM).json()["results"][0]
    assert body["delivery"]["delivery_fee"] == "15.50"


# --- Phase 6 filters (ARCHITECTURE D26) ----------------------------------------------------


def test_open_now_filter_excludes_closed_vendor():
    make_vendor("Closed Nearby", 28.4598, 77.0270, is_open=False, phone="+919000000401")
    make_vendor("Open Nearby", 28.4599, 77.0271, is_open=True, phone="+919000000402")
    r = APIClient().get(VENDORS, {**GURUGRAM, "open_now": "true"})
    names = [v["shop_name"] for v in r.json()["results"]]
    assert names == ["Open Nearby"]


def test_delivery_and_pickup_filters(near):
    near.delivery.delivery_enabled = True
    near.delivery.pickup_enabled = False
    near.delivery.save(update_fields=["delivery_enabled", "pickup_enabled"])
    assert APIClient().get(VENDORS, {**GURUGRAM, "delivery": "true"}).json()["count"] == 1
    assert APIClient().get(VENDORS, {**GURUGRAM, "pickup": "true"}).json()["count"] == 0


def test_filters_are_opt_in_default_behavior_unchanged():
    """Omitting the new filter params must not change the "never hide, only rank lower" default."""
    make_vendor("Closed Nearby", 28.4598, 77.0270, is_open=False, phone="+919000000403")
    make_vendor("Open Nearby", 28.4599, 77.0271, is_open=True, phone="+919000000404")
    r = APIClient().get(VENDORS, GURUGRAM)
    assert r.json()["count"] == 2
