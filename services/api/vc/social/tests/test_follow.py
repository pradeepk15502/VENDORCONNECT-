"""Phase 9 — Following (master prompt §5-§8): follow/unfollow, dedup, follower counts, the
Following list, and the followed-vendor feed."""

import pytest

from vc.orders.tests.conftest import second_customer_client, vendor_handle
from vc.social.models import Follow
from vc.vendors.models import Vendor

pytestmark = pytest.mark.django_db

FEED = "/api/v1/feed"
FOLLOWING = "/api/v1/following"


def _follow(client, handle):
    return client.post(f"/api/v1/vendors/{handle}/follow", format="json")


def _unfollow(client, handle):
    return client.post(f"/api/v1/vendors/{handle}/unfollow", format="json")


def test_follow_requires_auth(vendor_client):
    from rest_framework.test import APIClient

    handle = vendor_handle(vendor_client)
    r = _follow(APIClient(), handle)
    assert r.status_code == 401


def test_follow_then_unfollow_flow(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)

    r = _follow(api, handle)
    assert r.status_code == 201, r.content
    assert r.json() == {"following": True, "follower_count": 1}
    assert Follow.objects.filter(user=customer, vendor__handle=handle.lstrip("@")).exists()
    assert Vendor.objects.get(handle__iexact=handle).follower_count == 1

    # Following the same vendor again is idempotent: 200, not a second row, count unchanged.
    r2 = _follow(api, handle)
    assert r2.status_code == 200
    assert r2.json() == {"following": True, "follower_count": 1}
    assert Follow.objects.filter(user=customer, vendor__handle__iexact=handle).count() == 1

    r3 = _unfollow(api, handle)
    assert r3.status_code == 200
    assert r3.json() == {"following": False, "follower_count": 0}
    assert not Follow.objects.filter(user=customer, vendor__handle__iexact=handle).exists()


def test_unfollow_is_idempotent_when_never_followed(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    r = _unfollow(api, handle)
    assert r.status_code == 200
    assert r.json() == {"following": False, "follower_count": 0}


def test_vendor_cannot_follow_their_own_shop(vendor_client):
    handle = vendor_handle(vendor_client)
    r = _follow(vendor_client, handle)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "cannot_follow_own_shop"


def test_vendor_public_profile_reflects_is_following_and_follower_count(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    anon_view = api.get(f"/api/v1/vendors/{handle}")
    assert anon_view.json()["is_following"] is False
    assert anon_view.json()["follower_count"] == 0

    _follow(api, handle)
    mine = api.get(f"/api/v1/vendors/{handle}")
    assert mine.json()["is_following"] is True
    assert mine.json()["follower_count"] == 1

    other = second_customer_client()
    others_view = other.get(f"/api/v1/vendors/{handle}")
    assert others_view.json()["is_following"] is False
    assert others_view.json()["follower_count"] == 1  # count is global, following is per-viewer


def test_following_list_shows_followed_vendors_with_pagination_shape(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    _follow(api, handle)
    r = api.get(FOLLOWING)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1
    assert body["results"][0]["handle"].lstrip("@") == handle.lstrip("@")
    assert body["results"][0]["is_following"] is True
    assert body["results"][0]["distance_km"] is None  # no lat/lng sent


def test_following_list_computes_distance_when_location_given(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    _follow(api, handle)
    r = api.get(FOLLOWING, {"lat": 28.4595, "lng": 77.0266})
    assert r.status_code == 200
    assert r.json()["results"][0]["distance_km"] == 0.0


def test_following_list_excludes_unfollowed_and_requires_auth(api, customer, vendor_client):
    from rest_framework.test import APIClient

    handle = vendor_handle(vendor_client)
    _follow(api, handle)
    _unfollow(api, handle)
    assert api.get(FOLLOWING).json()["count"] == 0
    assert APIClient().get(FOLLOWING).status_code == 401


def test_feed_is_empty_for_a_customer_following_nobody(api, customer):
    r = api.get(FEED)
    assert r.status_code == 200
    assert r.json()["results"] == []


def test_feed_requires_auth():
    from rest_framework.test import APIClient

    assert APIClient().get(FEED).status_code == 401
