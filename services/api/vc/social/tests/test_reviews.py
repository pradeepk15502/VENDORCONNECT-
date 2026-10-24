"""Phase 9 — Reviews (master prompt §17-§24): tied to genuine completed orders, duplicate
prevention, vendor replies, and real (never hardcoded) rating aggregation."""

import pytest

from vc.notifications.models import Notification
from vc.orders.tests.conftest import second_customer_client, vendor_handle
from vc.orders.tests.test_orders import _place_order, _transition
from vc.vendors.models import Vendor

pytestmark = pytest.mark.django_db


def _complete_pickup_order(api, open_vendor, listing, key="review-order-1"):
    order = _place_order(api, open_vendor, listing, key=key)
    for action in ("accept", "preparing", "ready", "picked_up", "completed"):
        assert _transition(open_vendor, order["id"], action).status_code == 200
    return order


def _reviews_url(order_id) -> str:
    return f"/api/v1/orders/{order_id}/reviews"


# --- eligibility -----------------------------------------------------------------------------------


def test_cannot_review_an_order_that_is_not_completed(api, customer, open_vendor, listing):
    order = _place_order(api, open_vendor, listing, key="not-completed")
    r = api.post(_reviews_url(order["id"]), {"rating": 5}, format="json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "order_not_completed"


def test_only_the_customer_on_the_order_can_review_it(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    other = second_customer_client()
    r = other.post(_reviews_url(order["id"]), {"rating": 5}, format="json")
    assert r.status_code == 403


def test_vendor_cannot_review_their_own_order(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    r = open_vendor.post(_reviews_url(order["id"]), {"rating": 5}, format="json")
    assert r.status_code == 403


def test_rating_must_be_1_to_5(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    r = api.post(_reviews_url(order["id"]), {"rating": 6}, format="json")
    assert r.status_code == 400
    assert "rating" in r.json()["error"]["details"]


def test_listing_must_belong_to_the_reviewed_order(api, customer, open_vendor, listing, vendor_client):
    order = _complete_pickup_order(api, open_vendor, listing)
    other_listing = vendor_client.post(
        "/api/v1/vendor-products",
        {"category": "vegetables", "name": "Onion", "price": "25", "unit": "kg"},
        format="json",
    ).json()
    r = api.post(_reviews_url(order["id"]), {"rating": 4, "listing_id": other_listing["id"]}, format="json")
    assert r.status_code == 400
    assert "listing_id" in r.json()["error"]["details"]


# --- creation, verified purchase, notifications -----------------------------------------------------


def test_create_review_success_is_verified_and_notifies_both_sides(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    r = api.post(
        _reviews_url(order["id"]), {"rating": 5, "text": "Great tomatoes!", "listing_id": listing["id"]}, format="json"
    )
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["rating"] == 5
    assert body["text"] == "Great tomatoes!"
    assert body["verified_purchase"] is True
    assert body["order_id"] == order["id"]
    assert body["listing"] == {"id": listing["id"], "name": listing["name"]}
    assert body["author_name"] == "Asha"

    handle = vendor_handle(open_vendor)
    vendor = Vendor.objects.get(handle__iexact=handle)
    assert vendor.rating_avg == 5
    assert vendor.rating_count == 1

    assert Notification.objects.filter(kind="new_review", user=vendor.owner).exists()
    assert Notification.objects.filter(kind="review_posted", user=customer).exists()


def test_order_detail_exposes_review_id_once_reviewed(api, customer, open_vendor, listing):
    """Powers the order-tracking screen's "Rate your experience" vs. "You reviewed this order"
    state without a guess-and-fail POST (ARCHITECTURE D30)."""
    order = _complete_pickup_order(api, open_vendor, listing)
    before = api.get(f"/api/v1/orders/{order['id']}").json()
    assert before["review_id"] is None

    review = api.post(_reviews_url(order["id"]), {"rating": 4}, format="json").json()
    after = api.get(f"/api/v1/orders/{order['id']}").json()
    assert after["review_id"] == review["id"]


def test_duplicate_review_for_the_same_order_is_rejected(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    r1 = api.post(_reviews_url(order["id"]), {"rating": 5}, format="json")
    assert r1.status_code == 201
    r2 = api.post(_reviews_url(order["id"]), {"rating": 1}, format="json")
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "already_reviewed"


# --- aggregation -------------------------------------------------------------------------------------


def test_vendor_rating_aggregates_across_multiple_reviews(api, customer, open_vendor, listing):
    order1 = _complete_pickup_order(api, open_vendor, listing, key="agg-order-1")
    api.post(_reviews_url(order1["id"]), {"rating": 5}, format="json")

    other = second_customer_client()
    order2 = _complete_pickup_order(other, open_vendor, listing, key="agg-order-2")
    other.post(_reviews_url(order2["id"]), {"rating": 3}, format="json")

    handle = vendor_handle(open_vendor)
    vendor = Vendor.objects.get(handle__iexact=handle)
    assert vendor.rating_count == 2
    assert vendor.rating_avg == 4  # (5+3)/2


def test_vendor_rating_is_zero_with_no_reviews(vendor_client):
    handle = vendor_handle(vendor_client)
    vendor = Vendor.objects.get(handle__iexact=handle)
    assert vendor.rating_count == 0
    assert vendor.rating_avg == 0


# --- vendor reply ------------------------------------------------------------------------------------


def test_vendor_can_reply_to_their_own_review(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    review = api.post(_reviews_url(order["id"]), {"rating": 4}, format="json").json()

    r = open_vendor.post(f"/api/v1/reviews/{review['id']}/reply", {"vendor_reply": "Thank you!"}, format="json")
    assert r.status_code == 200
    assert r.json()["vendor_reply"] == "Thank you!"
    assert Notification.objects.filter(kind="review_reply", user=customer).exists()


def test_vendor_cannot_reply_to_another_vendors_review(api, customer, open_vendor, listing, vendor_client):
    from rest_framework.test import APIClient

    from conftest import SHOP, login

    order = _complete_pickup_order(api, open_vendor, listing)
    review = api.post(_reviews_url(order["id"]), {"rating": 4}, format="json").json()

    other_vendor = APIClient()
    login(other_vendor, "9666666666", "Other Vendor")
    other_vendor.post("/api/v1/vendors", {**SHOP, "shop_name": "Other Shop"}, format="json")

    r = other_vendor.post(f"/api/v1/reviews/{review['id']}/reply", {"vendor_reply": "hijack"}, format="json")
    assert r.status_code == 404


def test_customer_cannot_reply_as_vendor(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    review = api.post(_reviews_url(order["id"]), {"rating": 4}, format="json").json()
    r = api.post(f"/api/v1/reviews/{review['id']}/reply", {"vendor_reply": "nope"}, format="json")
    assert r.status_code == 403


# --- public display + reporting ------------------------------------------------------------------


def test_vendor_and_listing_review_lists_are_public(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    api.post(_reviews_url(order["id"]), {"rating": 5, "listing_id": listing["id"]}, format="json")

    from rest_framework.test import APIClient

    anon = APIClient()
    handle = vendor_handle(open_vendor)
    r = anon.get(f"/api/v1/vendors/{handle}/reviews")
    assert r.status_code == 200 and r.json()["count"] == 1

    r2 = anon.get(f"/api/v1/listings/{listing['id']}/reviews")
    assert r2.status_code == 200 and r2.json()["count"] == 1


def test_my_reviews_lists_only_the_authenticated_customers_own_reviews(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    mine = api.post(_reviews_url(order["id"]), {"rating": 5, "text": "Lovely shop"}, format="json").json()

    other = second_customer_client()
    other_order = _complete_pickup_order(other, open_vendor, listing, key="my-reviews-other")
    other.post(_reviews_url(other_order["id"]), {"rating": 2}, format="json")

    r = api.get("/api/v1/reviews/mine")
    assert r.status_code == 200
    assert r.json()["count"] == 1
    row = r.json()["results"][0]
    assert row["id"] == mine["id"]
    assert row["rating"] == 5
    assert row["status"] == "published"
    assert row["vendor"]["handle"].lstrip("@") == vendor_handle(open_vendor).lstrip("@")


def test_my_reviews_requires_auth():
    from rest_framework.test import APIClient

    assert APIClient().get("/api/v1/reviews/mine").status_code == 401


def test_report_review_creates_a_report(api, customer, open_vendor, listing):
    order = _complete_pickup_order(api, open_vendor, listing)
    review = api.post(_reviews_url(order["id"]), {"rating": 1}, format="json").json()

    other = second_customer_client()
    r = other.post(f"/api/v1/reviews/{review['id']}/report", {"reason": "abuse"}, format="json")
    assert r.status_code == 201

    from vc.moderation.models import Report

    assert Report.objects.filter(target_type="review", target_id=review["id"], reason="abuse").exists()
