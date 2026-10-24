"""Phase 11 — admin operational dashboard (master prompt §4/§5): every figure is a live DB
aggregate for the requested period. An empty platform must show real zeroes, never a fabricated or
placeholder number — this file's first real assertion is exactly that."""

import pytest
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.orders.tests.test_orders import _place_order

pytestmark = pytest.mark.django_db

DASHBOARD = "/api/v1/admin/dashboard"
_PASSWORD = "correct-horse-battery-staple"


def _admin_session(user, password: str = _PASSWORD) -> APIClient:
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
    user = User.objects.create_superuser(phone, password)
    return _admin_session(user, password), user


def _staff_login(phone: str, roles, password: str = _PASSWORD):
    user = User.objects.create_user(phone, password, roles=list(roles))
    return _admin_session(user, password), user


# --- authorization ---------------------------------------------------------------------------


def test_customer_cannot_view_dashboard(api, customer):
    assert api.get(DASHBOARD).status_code == 403


def test_vendor_cannot_view_dashboard(vendor_client):
    assert vendor_client.get(DASHBOARD).status_code == 403


def test_staff_role_alone_can_view_dashboard():
    staff, _ = _staff_login("+919888600001", roles=("support",))
    assert staff.get(DASHBOARD).status_code == 200  # IsStaffRole only — read-only metrics


# --- real, never-fabricated numbers ---------------------------------------------------------------


def test_empty_platform_shows_real_zeroes():
    """The only account in this test's own DB transaction is the superuser viewing the dashboard
    itself, so every count tied to accounts/vendors/orders/moderation/AI it reports must be exactly
    what's really there — 0 or 1 — never a placeholder."""
    superuser, _ = _superuser_login("+919888600002")
    r = superuser.get(DASHBOARD, {"range": "30d"})
    assert r.status_code == 200, r.content
    body = r.json()

    assert body["users"]["total"] == 1  # just the superuser created above
    assert body["vendors"]["total"] == 0
    assert body["orders"]["total"] == 0
    assert body["moderation"]["open_reports"] == 0
    assert body["moderation"]["hidden_content"] == 0
    assert body["ai"]["detections"] == 0


def test_dashboard_reflects_real_vendor_and_order_data(api, customer, open_vendor, listing):
    _place_order(api, open_vendor, listing)
    superuser, _ = _superuser_login("+919888600003")

    r = superuser.get(DASHBOARD, {"range": "30d"})
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["vendors"]["total"] >= 1
    assert body["vendors"]["active"] >= 1
    assert body["orders"]["total"] >= 1
    assert body["orders"]["pending"] >= 1  # a freshly placed order is neither completed nor cancelled


def test_dashboard_reports_the_resolved_period():
    superuser, _ = _superuser_login("+919888600004")

    today = superuser.get(DASHBOARD, {"range": "today"}).json()
    assert today["range"] == "today"

    default_range = superuser.get(DASHBOARD).json()
    assert default_range["range"] == "7d"  # documented default when `range` is omitted


def test_dashboard_custom_range_excludes_data_outside_the_window(api, customer, open_vendor, listing):
    _place_order(api, open_vendor, listing)
    superuser, _ = _superuser_login("+919888600005")

    far_past = superuser.get(DASHBOARD, {"range": "custom", "date_from": "2000-01-01", "date_to": "2000-01-02"})
    assert far_past.status_code == 200, far_past.content
    assert far_past.json()["orders"]["total"] == 0

    wide_open = superuser.get(DASHBOARD, {"range": "custom", "date_from": "2000-01-01", "date_to": "2999-01-01"})
    assert wide_open.json()["orders"]["total"] >= 1


def test_dashboard_custom_range_requires_both_dates():
    superuser, _ = _superuser_login("+919888600006")
    r = superuser.get(DASHBOARD, {"range": "custom"})
    assert r.status_code == 400


def test_dashboard_endpoint_is_read_only():
    superuser, _ = _superuser_login("+919888600007")
    assert superuser.post(DASHBOARD, {}, format="json").status_code == 405
