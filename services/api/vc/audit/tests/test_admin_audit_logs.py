"""Phase 11 — admin audit-log viewer (master prompt §15): the first read endpoint over the
append-only `AuditLog` trail that `vc.audit.service.record()` has been writing to since Phase 1.
Read-only by construction — there is no admin API path that can edit or delete a row, which is what
"audit logs are append-only from the admin UI perspective" means in practice."""

import pytest
from django.contrib.auth.models import Permission
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.vendors.models import Vendor

pytestmark = pytest.mark.django_db

LOGS = "/api/v1/admin/audit-logs"
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


def _grant(user, *codenames):
    user.user_permissions.add(*Permission.objects.filter(codename__in=codenames))


def _verify_vendor(vendor_client, phone: str) -> tuple[str, str]:
    """Performs a real admin action (vendor verification) so a genuine `AuditLog` row exists to read
    back — not a directly-constructed fixture row. Returns (vendor_id, actor_phone)."""
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    staff, user = _staff_login(phone, roles=("admin",))
    _grant(user, "verify_vendor")
    r = staff.post(f"/api/v1/admin/vendors/{handle}/verify", {"decision": "verified"}, format="json")
    assert r.status_code == 200, r.content
    vendor_id = str(Vendor.objects.get(handle__iexact=handle).id)
    return vendor_id, user


# --- authorization ---------------------------------------------------------------------------


def test_customer_cannot_list_audit_logs(api, customer):
    assert api.get(LOGS).status_code == 403


def test_vendor_cannot_list_audit_logs(vendor_client):
    assert vendor_client.get(LOGS).status_code == 403


def test_staff_role_alone_can_list_audit_logs(customer):
    staff, _ = _staff_login("+919888500001", roles=("support",))
    assert staff.get(LOGS).status_code == 200  # IsStaffRole only — read-only viewer, no fine-grained perm


# --- real entries, listing, filters --------------------------------------------------------------


def test_real_admin_action_is_visible_in_the_audit_log(vendor_client):
    vendor_id, actor = _verify_vendor(vendor_client, "+919888500002")
    superuser, _ = _superuser_login("+919888500003")

    r = superuser.get(LOGS)
    assert r.status_code == 200, r.content
    row = next(e for e in r.json()["results"] if e["action"] == "vendor.verified" and e["target_id"] == vendor_id)
    assert row["target_type"] == "vendor"
    assert row["actor_role"] == "admin"
    assert row["actor_name"]  # name or masked phone, never blank for a known actor


def test_filter_by_action(vendor_client):
    vendor_id, _ = _verify_vendor(vendor_client, "+919888500004")
    superuser, _ = _superuser_login("+919888500005")

    matching = superuser.get(LOGS, {"action": "vendor.verified"})
    assert any(e["target_id"] == vendor_id for e in matching.json()["results"])

    none_match = superuser.get(LOGS, {"action": "vendor.suspended"})
    assert not any(e["target_id"] == vendor_id for e in none_match.json()["results"])


def test_filter_by_target_type_and_target_id(vendor_client):
    vendor_id, _ = _verify_vendor(vendor_client, "+919888500006")
    superuser, _ = _superuser_login("+919888500007")

    by_type = superuser.get(LOGS, {"target_type": "vendor"})
    assert any(e["target_id"] == vendor_id for e in by_type.json()["results"])

    by_id = superuser.get(LOGS, {"target_id": vendor_id})
    assert all(e["target_id"] == vendor_id for e in by_id.json()["results"])
    assert len(by_id.json()["results"]) >= 1


def test_filter_by_actor_phone_or_id(vendor_client):
    vendor_id, actor = _verify_vendor(vendor_client, "+919888500008")
    superuser, _ = _superuser_login("+919888500009")

    by_phone = superuser.get(LOGS, {"actor": actor.phone})
    assert any(e["target_id"] == vendor_id for e in by_phone.json()["results"])

    by_id = superuser.get(LOGS, {"actor": str(actor.id)})
    assert any(e["target_id"] == vendor_id for e in by_id.json()["results"])


def test_filter_by_unknown_actor_is_404(customer):
    superuser, _ = _superuser_login("+919888500010")
    r = superuser.get(LOGS, {"actor": "+919000000000"})
    assert r.status_code == 404


def test_filter_by_date_range_excludes_out_of_window_entries(vendor_client):
    vendor_id, _ = _verify_vendor(vendor_client, "+919888500011")
    superuser, _ = _superuser_login("+919888500012")

    future_only = superuser.get(LOGS, {"date_from": "2999-01-01T00:00:00Z"})
    assert not any(e["target_id"] == vendor_id for e in future_only.json()["results"])

    past_only = superuser.get(LOGS, {"date_to": "2000-01-01T00:00:00Z"})
    assert not any(e["target_id"] == vendor_id for e in past_only.json()["results"])

    wide_open = superuser.get(LOGS, {"date_from": "2000-01-01T00:00:00Z", "date_to": "2999-01-01T00:00:00Z"})
    assert any(e["target_id"] == vendor_id for e in wide_open.json()["results"])


# --- privacy / immutability ----------------------------------------------------------------------


def test_audit_log_never_exposes_ip_hash_or_request_id(vendor_client):
    _verify_vendor(vendor_client, "+919888500013")
    superuser, _ = _superuser_login("+919888500014")
    row = superuser.get(LOGS).json()["results"][0]
    assert "ip_hash" not in row
    assert "request_id" not in row


def test_audit_log_is_read_only_via_the_admin_api(vendor_client):
    vendor_id, _ = _verify_vendor(vendor_client, "+919888500015")
    superuser, _ = _superuser_login("+919888500016")
    log_id = next(e["id"] for e in superuser.get(LOGS).json()["results"] if e["target_id"] == vendor_id)

    assert superuser.post(LOGS, {}, format="json").status_code == 405
    assert superuser.patch(f"{LOGS}/{log_id}", {}, format="json").status_code in (404, 405)
    assert superuser.delete(f"{LOGS}/{log_id}").status_code in (404, 405)


def test_audit_log_list_is_paginated(customer):
    superuser, _ = _superuser_login("+919888500017")
    body = superuser.get(LOGS).json()
    assert set(body.keys()) >= {"count", "page", "page_size", "results"}
