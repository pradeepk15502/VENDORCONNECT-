from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.catalog.models import Category, Product, VendorProduct
from vc.core.geo import make_point
from vc.vendors.handles import create_vendor_with_handle
from vc.vendors.models import DeliverySettings, Vendor, VendorLocation, VendorProfile

pytestmark = pytest.mark.django_db

GURUGRAM = {"lat": 28.4595, "lng": 77.0266}
SEARCH = "/api/v1/search"


def make_vendor(shop_name, lat, lng, *, is_open=True, phone="+919000000100"):
    user = User.objects.create_user(phone=phone, roles=("customer",))
    vendor = create_vendor_with_handle(owner=user, shop_name=shop_name, public_phone=phone)
    vendor.categories.set(Category.objects.filter(slug="vegetables"))
    VendorProfile.objects.create(vendor=vendor, bio="")
    VendorLocation.objects.create(vendor=vendor, point=make_point(lat, lng), address_line="Shop", city="Gurugram")
    DeliverySettings.objects.create(vendor=vendor)
    if is_open:
        vendor.is_open, vendor.status_changed_at = True, timezone.now()
        vendor.save(update_fields=["is_open", "status_changed_at"])
    user.add_role("vendor")
    return vendor


def make_listing(vendor, product_slug, **overrides):
    product = Product.objects.get(slug=product_slug)
    now = timezone.now()
    defaults = {
        "category": product.category,
        "name": product.name,
        "price": Decimal("40"),
        "unit": product.default_unit,
        "availability": VendorProduct.AVAIL_IN_STOCK,
        "stock_updated_at": now,
        "price_updated_at": now,
    }
    defaults.update(overrides)
    return VendorProduct.objects.create(vendor=vendor, product=product, **defaults)


@pytest.fixture
def near(db):
    """~50 m from Gurugram centre."""
    return make_vendor("Sharma Vegetable Store", 28.4598, 77.0270, phone="+919000000101")


@pytest.fixture
def far(db):
    """~7.8 km north of Gurugram centre — outside the default 5 km search radius."""
    return make_vendor("Far Vegetable Store", 28.5295, 77.0266, phone="+919000000102")


def test_alias_trigram_finds_english_hindi_and_transliteration(near):
    make_listing(near, "tomato")
    for q in ["tomato", "tamatar", "टमाटर", "tomatoes"]:
        r = APIClient().get(SEARCH, {"q": q, **GURUGRAM})
        assert r.status_code == 200, (q, r.content)
        names = [x["product"]["slug"] for x in r.json()["results"]]
        assert "tomato" in names, f"{q!r} should resolve to tomato, got {names}"


def test_unrelated_query_returns_no_results(near):
    make_listing(near, "tomato")
    r = APIClient().get(SEARCH, {"q": "zzxxqqnonsense", **GURUGRAM})
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_custom_listing_without_product_matches_on_its_own_name(near):
    VendorProduct.objects.create(
        vendor=near,
        product=None,
        category=Category.objects.get(slug="household"),
        name="Handmade Diya Set",
        price=Decimal("99"),
        unit="box",
        stock_updated_at=timezone.now(),
        price_updated_at=timezone.now(),
    )
    r = APIClient().get(SEARCH, {"q": "diya set", **GURUGRAM})
    assert r.status_code == 200
    assert [x["name"] for x in r.json()["results"]] == ["Handmade Diya Set"]


def test_default_radius_excludes_far_vendor(near, far):
    make_listing(near, "tomato")
    make_listing(far, "tomato")
    r = APIClient().get(SEARCH, {"q": "tomato", **GURUGRAM})
    shops = [x["vendor"]["shop_name"] for x in r.json()["results"]]
    assert shops == ["Sharma Vegetable Store"]


def test_wider_radius_includes_far_vendor_ranked_after_near_one(near, far):
    make_listing(near, "tomato")
    make_listing(far, "tomato")
    r = APIClient().get(SEARCH, {"q": "tomato", "radius_km": 10, **GURUGRAM})
    shops = [x["vendor"]["shop_name"] for x in r.json()["results"]]
    assert shops == ["Sharma Vegetable Store", "Far Vegetable Store"]  # nearer ranks first


def test_category_browse_without_a_text_query(near):
    make_listing(near, "tomato")
    make_listing(near, "rice", category=Category.objects.get(slug="grocery"))
    r = APIClient().get(SEARCH, {"category": "grocery", **GURUGRAM})
    assert r.status_code == 200
    slugs = [x["product"]["slug"] for x in r.json()["results"]]
    assert slugs == ["rice"]


def test_browse_all_with_no_query_and_no_category(near):
    make_listing(near, "tomato")
    make_listing(near, "onion")
    r = APIClient().get(SEARCH, GURUGRAM)
    assert r.status_code == 200
    assert r.json()["count"] == 2


def test_closed_and_out_of_stock_shown_but_ranked_lower(near, far):
    """ARCHITECTURE D9/D10: never hide, only rank lower."""
    far.is_open = False
    far.save(update_fields=["is_open"])
    make_listing(near, "tomato", availability=VendorProduct.AVAIL_IN_STOCK)
    make_listing(far, "tomato", availability=VendorProduct.AVAIL_OUT)
    r = APIClient().get(SEARCH, {"q": "tomato", "radius_km": 10, **GURUGRAM})
    results = r.json()["results"]
    assert {x["vendor"]["shop_name"] for x in results} == {"Sharma Vegetable Store", "Far Vegetable Store"}
    assert results[0]["vendor"]["shop_name"] == "Sharma Vegetable Store"
    far_result = next(x for x in results if x["vendor"]["shop_name"] == "Far Vegetable Store")
    assert far_result["availability"] == "out_of_stock" and far_result["vendor"]["is_open"] is False


def test_stale_listing_flagged(near):
    """Vegetables go stale after 24h per taxonomy.json's per-category threshold."""
    make_listing(near, "tomato", stock_updated_at=timezone.now() - timedelta(hours=30))
    r = APIClient().get(SEARCH, {"q": "tomato", **GURUGRAM})
    assert r.json()["results"][0]["freshness"] == "stale"


def test_suspended_vendor_excluded(near):
    make_listing(near, "tomato")
    near.status = Vendor.STATUS_SUSPENDED
    near.save(update_fields=["status"])
    r = APIClient().get(SEARCH, {"q": "tomato", **GURUGRAM})
    assert r.json()["count"] == 0


def test_paused_listing_excluded(near):
    make_listing(near, "tomato", status=VendorProduct.STATUS_PAUSED)
    r = APIClient().get(SEARCH, {"q": "tomato", **GURUGRAM})
    assert r.json()["count"] == 0


def test_pagination(near):
    for slug in ["tomato", "onion", "potato"]:
        make_listing(near, slug)
    r = APIClient().get(SEARCH, {"page_size": 2, **GURUGRAM})
    body = r.json()
    assert body["count"] == 3 and len(body["results"]) == 2 and body["next"] is not None
    r2 = APIClient().get(body["next"])
    assert len(r2.json()["results"]) == 1 and r2.json()["previous"] is not None


def test_result_shape(near):
    make_listing(near, "tomato", mrp=Decimal("45"))
    result = APIClient().get(SEARCH, {"q": "tomato", **GURUGRAM}).json()["results"][0]
    assert result["vendor"] == {
        "handle": near.handle,
        "vendor_id": near.display_handle,
        "shop_name": "Sharma Vegetable Store",
        "is_open": True,
        "verified": False,
        "delivery_enabled": False,
        "lat": 28.4598,
        "lng": 77.027,
    }
    assert result["mrp"] == "45.00" and result["distance_km"] < 1 and result["category"] == "vegetables"


@pytest.mark.parametrize(
    "params,field",
    [
        ({"q": "tomato", "lng": 77.0266}, "lat"),
        ({"q": "tomato", "lat": 28.4595}, "lng"),
        ({"q": "tomato", **GURUGRAM, "category": "not-a-category"}, "category"),
        ({"q": "tomato", **GURUGRAM, "radius_km": 100}, "radius_km"),
        ({"q": "tomato", **GURUGRAM, "radius_km": 0}, "radius_km"),
        ({"q": "tomato", "lat": 51.5, "lng": -0.1}, "lat"),  # London: outside India bounds
    ],
)
def test_validation_errors(params, field):
    r = APIClient().get(SEARCH, params)
    assert r.status_code == 400, r.content
    assert field in r.json()["error"]["details"]


def test_no_auth_required(near):
    """Customers can search before signing in (ARCHITECTURE D17)."""
    make_listing(near, "tomato")
    r = APIClient().get(SEARCH, {"q": "tomato", **GURUGRAM})  # no credentials set
    assert r.status_code == 200 and r.json()["count"] == 1


# --- Phase 6 filters (ARCHITECTURE D26) ----------------------------------------------------


def test_in_stock_only_excludes_out_of_stock_but_keeps_low_stock(near):
    make_listing(near, "tomato", name="Out", availability=VendorProduct.AVAIL_OUT)
    make_listing(near, "onion", name="Low", availability=VendorProduct.AVAIL_LOW)
    r = APIClient().get(SEARCH, {"in_stock_only": "true", **GURUGRAM})
    names = {x["name"] for x in r.json()["results"]}
    assert names == {"Low"}


def test_open_now_excludes_closed_vendor(near, far):
    far.is_open = False
    far.save(update_fields=["is_open"])
    make_listing(near, "tomato")
    make_listing(far, "onion")
    r = APIClient().get(SEARCH, {"open_now": "true", "radius_km": 10, **GURUGRAM})
    shops = {x["vendor"]["shop_name"] for x in r.json()["results"]}
    assert shops == {"Sharma Vegetable Store"}


def test_delivery_and_pickup_filters(near):
    near.delivery.delivery_enabled = True
    near.delivery.pickup_enabled = False
    near.delivery.save(update_fields=["delivery_enabled", "pickup_enabled"])
    make_listing(near, "tomato")
    assert APIClient().get(SEARCH, {"delivery": "true", **GURUGRAM}).json()["count"] == 1
    assert APIClient().get(SEARCH, {"pickup": "true", **GURUGRAM}).json()["count"] == 0


def test_price_range_filter(near):
    make_listing(near, "tomato", name="Cheap", price=Decimal("10"))
    make_listing(near, "onion", name="Mid", price=Decimal("40"))
    make_listing(near, "potato", name="Pricey", price=Decimal("100"))
    r = APIClient().get(SEARCH, {"price_min": 20, "price_max": 60, **GURUGRAM})
    assert {x["name"] for x in r.json()["results"]} == {"Mid"}


def test_price_max_below_price_min_is_a_validation_error(near):
    r = APIClient().get(SEARCH, {"price_min": 50, "price_max": 10, **GURUGRAM})
    assert r.status_code == 400
    assert "price_max" in r.json()["error"]["details"]


def test_filters_are_opt_in_default_behavior_unchanged(near, far):
    """Omitting the new filter params must not change D9's "never hide" default."""
    far.is_open = False
    far.save(update_fields=["is_open"])
    make_listing(near, "tomato")
    make_listing(far, "tomato", availability=VendorProduct.AVAIL_OUT)
    r = APIClient().get(SEARCH, {"q": "tomato", "radius_km": 10, **GURUGRAM})
    assert r.json()["count"] == 2
