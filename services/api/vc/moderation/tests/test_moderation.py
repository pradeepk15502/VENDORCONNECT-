"""Phase 9 — Reporting + admin moderation (master prompt §25-§27): reports, staff-only access,
fine-grained admin permissions, and the hide/unhide flow that never silently deletes data."""

import io

import pytest
from django.contrib.auth.models import Permission
from PIL import Image
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.moderation.models import Report
from vc.orders.tests.test_orders import _place_order, _transition
from vc.social.models import Post, Review
from vc.vendors.models import Vendor

pytestmark = pytest.mark.django_db

REPORTS = "/api/v1/moderation/reports"
POSTS_MOD = "/api/v1/moderation/posts"
REVIEWS_MOD = "/api/v1/moderation/reviews"


_PASSWORD = "correct-horse-battery-staple"


def _admin_session(user, password: str = _PASSWORD) -> APIClient:
    """Runs the real two-step admin login (password, then OTP with purpose=admin — same flow
    `test_admin_requires_password_plus_otp` exercises) so these tests hit the same `_admin_session`
    token claim the views actually check, not a shortcut."""
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
    """A real superuser — every `admin_permission(...)` check passes unconditionally, for tests
    that aren't about permission *granting* itself."""
    user = User.objects.create_superuser(phone, password)
    return _admin_session(user, password), user


def _staff_login(phone: str, roles, password: str = _PASSWORD):
    """A non-superuser staff account with only a role (admin/moderator/support) — passes
    `IsStaffRole` but needs an explicit `_grant(...)` to pass any `admin_permission(...)` check."""
    user = User.objects.create_user(phone, password, roles=list(roles))
    return _admin_session(user, password), user


def _grant(user, *codenames):
    user.user_permissions.add(*Permission.objects.filter(codename__in=codenames))


def _jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (200, 50, 50)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(client) -> str:
    f = io.BytesIO(_jpeg_bytes())
    f.name = "post.jpg"
    r = client.post("/api/v1/media", {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    return r.json()["id"]


def _create_post(vendor_client) -> dict:
    asset_id = _upload(vendor_client)
    r = vendor_client.post(
        "/api/v1/vendors/me/posts",
        {"kind": "update", "caption": "Shop update", "media_asset_ids": [asset_id]},
        format="json",
    )
    assert r.status_code == 201, r.content
    return r.json()


def _create_review(api, open_vendor, listing, rating=4, key="mod-order-1") -> dict:
    order = _place_order(api, open_vendor, listing, key=key)
    for action in ("accept", "preparing", "ready", "picked_up", "completed"):
        assert _transition(open_vendor, order["id"], action).status_code == 200
    r = api.post(f"/api/v1/orders/{order['id']}/reviews", {"rating": rating}, format="json")
    assert r.status_code == 201, r.content
    return r.json()


# --- authorization -----------------------------------------------------------------------------


def test_non_staff_cannot_list_or_resolve_reports(api, customer):
    assert api.get(REPORTS).status_code == 403
    resolve_url = f"{REPORTS}/00000000-0000-0000-0000-000000000000/resolve"
    assert api.post(resolve_url, {"status": "resolved"}, format="json").status_code == 403


def test_plain_otp_session_for_an_admin_role_user_is_rejected():
    """An admin-role user who only did a plain OTP login (no password+OTP admin session) still
    can't reach the moderation API — mirrors the existing `IsAdmin`/`IsStaffRole` precedent."""
    from conftest import login

    User.objects.create_user("+919888000001", "irrelevant", roles=["admin"])
    plain = APIClient()
    login(plain, "9888000001", "Staffer")
    assert plain.get(REPORTS).status_code == 403


def test_moderator_without_specific_permission_cannot_hide_content(vendor_client):
    post = _create_post(vendor_client)
    staff, _ = _staff_login("+919888000002", roles=("moderator",))
    assert staff.get(POSTS_MOD).status_code == 200  # IsStaffRole only — listing is fine
    r = staff.post(f"{POSTS_MOD}/{post['id']}/hide", format="json")
    assert r.status_code == 403


# --- reports -------------------------------------------------------------------------------------


def test_report_appears_in_the_admin_report_list(api, customer, vendor_client):
    post = _create_post(vendor_client)
    r = api.post(f"/api/v1/posts/{post['id']}/report", {"reason": "spam"}, format="json")
    assert r.status_code == 201

    superuser, _ = _superuser_login("+919888000003")
    listed = superuser.get(REPORTS)
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert listed.json()["results"][0]["target_type"] == "post"

    filtered = superuser.get(REPORTS, {"target_type": "review"})
    assert filtered.json()["count"] == 0


def test_resolving_a_report_with_hide_target_hides_the_post(api, customer, vendor_client):
    post = _create_post(vendor_client)
    api.post(f"/api/v1/posts/{post['id']}/report", {"reason": "inappropriate"}, format="json")
    report = Report.objects.get(target_type="post", target_id=post["id"])

    staff, user = _staff_login("+919888000004", roles=("moderator",))
    _grant(user, "handle_report")

    r = staff.post(f"{REPORTS}/{report.id}/resolve", {"status": "resolved", "hide_target": True}, format="json")
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"
    assert Post.objects.get(id=post["id"]).status == Post.STATUS_HIDDEN

    # A hidden post 404s for the public, exactly like moderation's own hide endpoint.
    anon = APIClient()
    assert anon.get(f"/api/v1/posts/{post['id']}").status_code == 404


def test_dismissing_a_report_does_not_hide_anything(api, customer, vendor_client):
    post = _create_post(vendor_client)
    api.post(f"/api/v1/posts/{post['id']}/report", {"reason": "other"}, format="json")
    report = Report.objects.get(target_type="post", target_id=post["id"])

    staff, user = _staff_login("+919888000005", roles=("moderator",))
    _grant(user, "handle_report")
    r = staff.post(f"{REPORTS}/{report.id}/resolve", {"status": "dismissed"}, format="json")
    assert r.status_code == 200
    assert Post.objects.get(id=post["id"]).status == Post.STATUS_PUBLISHED


# --- post moderation -----------------------------------------------------------------------------


def test_admin_can_hide_and_unhide_a_post(vendor_client):
    post = _create_post(vendor_client)
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    staff, user = _staff_login("+919888000006", roles=("moderator",))
    _grant(user, "moderate_post")

    r = staff.post(f"{POSTS_MOD}/{post['id']}/hide", format="json")
    assert r.status_code == 200 and r.json()["status"] == "hidden"

    anon = APIClient()
    public_list = anon.get(f"/api/v1/vendors/{handle}/posts")
    assert public_list.json()["count"] == 0  # hidden posts drop out of the public "Posts" tab

    r2 = staff.post(f"{POSTS_MOD}/{post['id']}/unhide", format="json")
    assert r2.status_code == 200 and r2.json()["status"] == "published"
    assert anon.get(f"/api/v1/vendors/{handle}/posts").json()["count"] == 1


def test_post_moderation_list_filters_by_status(vendor_client):
    post = _create_post(vendor_client)
    superuser, _ = _superuser_login("+919888000007")
    superuser.post(f"{POSTS_MOD}/{post['id']}/hide", format="json")

    hidden_only = superuser.get(POSTS_MOD, {"status": "hidden"})
    assert [p["id"] for p in hidden_only.json()["results"]] == [post["id"]]
    published_only = superuser.get(POSTS_MOD, {"status": "published"})
    assert published_only.json()["count"] == 0


# --- review moderation + rating recompute --------------------------------------------------------


def test_hiding_a_review_recomputes_vendor_rating(api, customer, open_vendor, listing):
    review1 = _create_review(api, open_vendor, listing, rating=5, key="mod-order-a")
    handle = open_vendor.get("/api/v1/vendors/me").json()["handle"]
    vendor = Vendor.objects.get(handle__iexact=handle)
    assert vendor.rating_count == 1 and vendor.rating_avg == 5

    superuser, _ = _superuser_login("+919888000008")
    r = superuser.post(f"{REVIEWS_MOD}/{review1['id']}/hide", format="json")
    assert r.status_code == 200 and r.json()["status"] == "hidden"

    vendor.refresh_from_db()
    assert vendor.rating_count == 0
    assert vendor.rating_avg == 0

    r2 = superuser.post(f"{REVIEWS_MOD}/{review1['id']}/unhide", format="json")
    assert r2.status_code == 200 and r2.json()["status"] == "published"
    vendor.refresh_from_db()
    assert vendor.rating_count == 1 and vendor.rating_avg == 5
    assert Review.objects.get(id=review1["id"]).status == Review.STATUS_PUBLISHED


def test_review_moderation_list_filters_by_vendor(api, customer, open_vendor, listing):
    _create_review(api, open_vendor, listing, rating=3, key="mod-order-b")
    handle = open_vendor.get("/api/v1/vendors/me").json()["handle"]
    superuser, _ = _superuser_login("+919888000009")

    r = superuser.get(REVIEWS_MOD, {"vendor": handle})
    assert r.status_code == 200 and r.json()["count"] == 1
    r2 = superuser.get(REVIEWS_MOD, {"vendor": "@nonexistent"})
    assert r2.json()["count"] == 0
