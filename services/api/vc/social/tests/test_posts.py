"""Phase 9 — Posts (master prompt §9-§16, §33-§36): creation, media/product ownership
validation, the vendor-owner-only edit/delete surface, and the followed-vendor feed."""

import io

import pytest
from PIL import Image
from rest_framework.test import APIClient

from vc.orders.tests.conftest import vendor_handle
from vc.social.models import Post

pytestmark = pytest.mark.django_db

MEDIA = "/api/v1/media"
MY_POSTS = "/api/v1/vendors/me/posts"
FEED = "/api/v1/feed"


def _jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (600, 400), (0, 180, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(client) -> str:
    f = io.BytesIO(_jpeg_bytes())
    f.name = "stock.jpg"
    r = client.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    return r.json()["id"]


def _create_post(client, media_ids, **extra):
    payload = {"kind": "new_stock", "caption": "Fresh Hybrid Tomatoes Arrived", "media_asset_ids": media_ids, **extra}
    return client.post(MY_POSTS, payload, format="json")


# --- creation & validation -----------------------------------------------------------------------


def test_customer_cannot_create_a_post(api, customer):
    asset_id = _upload(api)
    r = _create_post(api, [asset_id])
    assert r.status_code == 403


def test_create_post_requires_at_least_one_media_asset(vendor_client):
    r = _create_post(vendor_client, [])
    assert r.status_code == 400
    assert "media_asset_ids" in r.json()["error"]["details"]


def test_create_post_with_product_attachment(vendor_client, listing):
    asset_id = _upload(vendor_client)
    r = _create_post(vendor_client, [asset_id], listing_ids=[listing["id"]])
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["kind"] == "new_stock"
    assert body["caption"] == "Fresh Hybrid Tomatoes Arrived"
    assert body["vendor"]["handle"].lstrip("@") == vendor_handle(vendor_client).lstrip("@")
    assert body["media"][0]["id"] == asset_id
    assert set(body["media"][0]["variant_urls"]) == {"large", "medium", "thumb"}
    assert body["linked_listings"] == [
        {
            "id": listing["id"],
            "name": listing["name"],
            "price": listing["price"],
            "unit": listing["unit"],
            "unit_quantity": listing["unit_quantity"],
            "availability": listing["availability"],
        }
    ]


def test_create_post_rejects_media_uploaded_by_someone_else(api, customer, vendor_client):
    """A vendor cannot smuggle in another user's uploaded file by id (master prompt §13/§45: never
    trust frontend-supplied ids)."""
    asset_id = _upload(api)  # uploaded by the customer, not the vendor
    r = _create_post(vendor_client, [asset_id])
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_media"


def test_create_post_rejects_another_vendors_product(vendor_client, listing):
    other = APIClient()
    from conftest import SHOP, login

    login(other, "9333333333", "Other Vendor")
    other.post("/api/v1/vendors", {**SHOP, "shop_name": "Other Shop"}, format="json")

    asset_id = _upload(other)
    r = _create_post(other, [asset_id], listing_ids=[listing["id"]])  # listing belongs to vendor_client, not `other`
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_listing"


# --- visibility & ownership ------------------------------------------------------------------------


def test_vendor_posts_public_view_and_post_detail(vendor_client, listing):
    asset_id = _upload(vendor_client)
    created = _create_post(vendor_client, [asset_id], listing_ids=[listing["id"]]).json()
    handle = vendor_handle(vendor_client)

    anon = APIClient()
    r = anon.get(f"/api/v1/vendors/{handle}/posts")
    assert r.status_code == 200
    assert r.json()["count"] == 1
    assert r.json()["results"][0]["id"] == created["id"]

    detail = anon.get(f"/api/v1/posts/{created['id']}")
    assert detail.status_code == 200
    assert detail.json()["id"] == created["id"]


def test_post_detail_404_for_unknown_id():
    anon = APIClient()
    r = anon.get("/api/v1/posts/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_vendor_can_update_own_post(vendor_client, listing):
    asset_id = _upload(vendor_client)
    created = _create_post(vendor_client, [asset_id]).json()
    r = vendor_client.patch(f"/api/v1/posts/{created['id']}", {"caption": "Updated caption"}, format="json")
    assert r.status_code == 200
    assert r.json()["caption"] == "Updated caption"


def test_vendor_a_cannot_edit_or_delete_vendor_bs_post(vendor_client):
    asset_id = _upload(vendor_client)
    created = _create_post(vendor_client, [asset_id]).json()

    other = APIClient()
    from conftest import SHOP, login

    login(other, "9222222222", "Vendor B")
    other.post("/api/v1/vendors", {**SHOP, "shop_name": "Vendor B Shop"}, format="json")

    r = other.patch(f"/api/v1/posts/{created['id']}", {"caption": "hijacked"}, format="json")
    assert r.status_code == 404
    r2 = other.delete(f"/api/v1/posts/{created['id']}")
    assert r2.status_code == 404
    assert Post.objects.get(id=created["id"]).caption != "hijacked"


def test_customer_cannot_edit_or_delete_a_post(api, customer, vendor_client):
    asset_id = _upload(vendor_client)
    created = _create_post(vendor_client, [asset_id]).json()
    assert api.patch(f"/api/v1/posts/{created['id']}", {"caption": "nope"}, format="json").status_code == 403
    assert api.delete(f"/api/v1/posts/{created['id']}").status_code == 403


def test_vendor_can_delete_own_post(vendor_client):
    asset_id = _upload(vendor_client)
    created = _create_post(vendor_client, [asset_id]).json()
    r = vendor_client.delete(f"/api/v1/posts/{created['id']}")
    assert r.status_code == 204
    assert not Post.objects.filter(id=created["id"]).exists()


def test_my_posts_collection_lists_own_posts_newest_first(vendor_client):
    id1 = _create_post(vendor_client, [_upload(vendor_client)]).json()["id"]
    id2 = _create_post(vendor_client, [_upload(vendor_client)]).json()["id"]
    r = vendor_client.get(MY_POSTS)
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["results"]] == [id2, id1]


# --- feed integration (follow -> post -> feed, master prompt §36) --------------------------------


def test_feed_shows_posts_only_from_followed_vendors(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    other_vendor = APIClient()
    from conftest import SHOP, login

    login(other_vendor, "9111111111", "Unfollowed Vendor")
    other_vendor.post("/api/v1/vendors", {**SHOP, "shop_name": "Unfollowed Shop"}, format="json")

    followed_post = _create_post(vendor_client, [_upload(vendor_client)]).json()
    _create_post(other_vendor, [_upload(other_vendor)])  # not followed — must not appear

    api.post(f"/api/v1/vendors/{handle}/follow", format="json")
    r = api.get(FEED)
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["results"]] == [followed_post["id"]]


def test_report_post_creates_a_report(api, customer, vendor_client):
    created = _create_post(vendor_client, [_upload(vendor_client)]).json()
    r = api.post(f"/api/v1/posts/{created['id']}/report", {"reason": "spam"}, format="json")
    assert r.status_code == 201

    from vc.moderation.models import Report

    report = Report.objects.get(target_type="post", target_id=created["id"])
    assert report.reason == "spam"
    assert report.reporter_id == customer.id


def test_report_post_requires_a_valid_reason(api, customer, vendor_client):
    created = _create_post(vendor_client, [_upload(vendor_client)]).json()
    r = api.post(f"/api/v1/posts/{created['id']}/report", {"reason": "not_a_real_reason"}, format="json")
    assert r.status_code == 400
