"""Phase 11 — admin vendor management + verification (master prompt §8/§9): list/detail across
every vendor regardless of status, plus verify/reject (reusing the Phase 8/9 `verify_vendor` Django
permission that existed but nothing wrote to) and suspend/restore (`suspend_vendor`)."""

import pytest
from django.contrib.auth.models import Permission
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.audit.models import AuditLog
from vc.vendors.models import Vendor, VendorVerification

pytestmark = pytest.mark.django_db

VENDORS = "/api/v1/admin/vendors"
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


# --- authorization ---------------------------------------------------------------------------


def test_customer_cannot_list_vendors(api, customer):
    assert api.get(VENDORS).status_code == 403


def test_staff_can_list_but_not_verify_without_specific_permission(vendor_client):
    staff, _ = _staff_login("+919888200001", roles=("support",))
    assert staff.get(VENDORS).status_code == 200
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    r = staff.post(f"{VENDORS}/{handle}/verify", {"decision": "verified"}, format="json")
    assert r.status_code == 403


# --- listing / search / filter -----------------------------------------------------------------


def test_admin_list_includes_vendors_regardless_of_status(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    Vendor.objects.filter(handle=handle).update(status=Vendor.STATUS_SUSPENDED)
    superuser, _ = _superuser_login("+919888200002")

    # A suspended vendor is invisible on the public list...
    anon = APIClient()
    public_results = anon.get("/api/v1/vendors", {"lat": 28.4595, "lng": 77.0266}).json()["results"]
    assert not any(v["handle"] == handle for v in public_results)
    # ...but the admin list still shows it.
    admin_list = superuser.get(VENDORS)
    assert any(v["handle"] == handle for v in admin_list.json()["results"])


def test_admin_can_search_and_filter_vendors(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    superuser, _ = _superuser_login("+919888200003")

    by_name = superuser.get(VENDORS, {"q": "Sharma"})
    assert any(v["handle"] == handle for v in by_name.json()["results"])

    by_handle = superuser.get(VENDORS, {"q": handle})
    assert any(v["handle"] == handle for v in by_handle.json()["results"])

    by_status = superuser.get(VENDORS, {"status": "active"})
    assert all(v["status"] == "active" for v in by_status.json()["results"])

    by_category = superuser.get(VENDORS, {"category": "vegetables"})
    assert any(v["handle"] == handle for v in by_category.json()["results"])

    no_match = superuser.get(VENDORS, {"q": "no-such-shop-xyz"})
    assert no_match.json()["count"] == 0


def test_vendor_detail_includes_owner_and_counts(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    superuser, _ = _superuser_login("+919888200004")
    r = superuser.get(f"{VENDORS}/{handle}")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["owner"]["phone"]
    assert body["product_count"] == 0
    assert body["location"]["city"] == "Gurugram"


# --- verification ----------------------------------------------------------------------------


def test_admin_can_verify_a_vendor(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    staff, user = _staff_login("+919888200005", roles=("admin",))
    _grant(user, "verify_vendor")

    r = staff.post(f"{VENDORS}/{handle}/verify", {"decision": "verified", "notes": "docs checked"}, format="json")
    assert r.status_code == 200, r.content
    assert r.json()["verification_status"] == "verified"

    vendor = Vendor.objects.get(handle__iexact=handle)
    assert vendor.verification_status == Vendor.VERIFY_VERIFIED
    assert vendor.verified_at is not None
    decision = VendorVerification.objects.get(vendor=vendor)
    assert decision.decision == "verified" and decision.decided_by == user and decision.notes == "docs checked"

    # The public vendor profile now reflects verified=true.
    anon = APIClient()
    profile = anon.get(f"/api/v1/vendors/{handle}")
    assert profile.json()["verified"] is True


def test_admin_can_reject_a_vendor(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    staff, user = _staff_login("+919888200006", roles=("admin",))
    _grant(user, "verify_vendor")
    r = staff.post(f"{VENDORS}/{handle}/verify", {"decision": "rejected", "notes": "invalid GSTIN"}, format="json")
    assert r.status_code == 200
    assert r.json()["verification_status"] == "rejected"
    assert Vendor.objects.get(handle__iexact=handle).verified_at is None


def test_verify_rejects_unknown_decision_value(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    staff, user = _staff_login("+919888200007", roles=("admin",))
    _grant(user, "verify_vendor")
    r = staff.post(f"{VENDORS}/{handle}/verify", {"decision": "maybe"}, format="json")
    assert r.status_code == 400


# --- suspend / restore -----------------------------------------------------------------------


def test_admin_can_suspend_and_restore_a_vendor(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    staff, user = _staff_login("+919888200008", roles=("admin",))
    _grant(user, "suspend_vendor")

    r = staff.post(f"{VENDORS}/{handle}/suspend", {"reason": "fraud report"}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "suspended"

    anon = APIClient()
    assert anon.get(f"/api/v1/vendors/{handle}").status_code == 404  # suspended vendors 404 publicly

    r2 = staff.post(f"{VENDORS}/{handle}/restore", format="json")
    assert r2.status_code == 200 and r2.json()["status"] == "active"
    assert anon.get(f"/api/v1/vendors/{handle}").status_code == 200


def test_verify_and_suspend_write_audit_log_entries(vendor_client):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    vendor_id = Vendor.objects.get(handle__iexact=handle).id
    staff, user = _staff_login("+919888200009", roles=("admin",))
    _grant(user, "verify_vendor", "suspend_vendor")

    staff.post(f"{VENDORS}/{handle}/verify", {"decision": "verified"}, format="json")
    staff.post(f"{VENDORS}/{handle}/suspend", {"reason": "test"}, format="json")
    staff.post(f"{VENDORS}/{handle}/restore", format="json")

    assert AuditLog.objects.filter(action="vendor.verified", target_id=str(vendor_id)).exists()
    assert AuditLog.objects.filter(action="vendor.suspended", target_id=str(vendor_id)).exists()
    assert AuditLog.objects.filter(action="vendor.restored", target_id=str(vendor_id)).exists()


def test_verify_is_atomic_partial_failure_leaves_no_orphaned_record(monkeypatch, vendor_client):
    """Phase 12 hardening: the `VendorVerification` audit row and the vendor's live
    `verification_status` are one decision, not two independent writes — if the second write fails,
    the first must not survive either, or the audit trail would disagree with the vendor's own
    (unchanged) status forever."""
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    vendor_before = Vendor.objects.get(handle__iexact=handle)
    staff, user = _staff_login("+919888200010", roles=("admin",))
    staff.raise_request_exception = False
    _grant(user, "verify_vendor")

    def boom(self, *args, **kwargs):
        raise RuntimeError("simulated DB failure mid-decision")

    monkeypatch.setattr(Vendor, "save", boom)
    r = staff.post(f"{VENDORS}/{handle}/verify", {"decision": "verified", "notes": "x"}, format="json")
    assert r.status_code == 500

    assert not VendorVerification.objects.filter(vendor=vendor_before).exists()
    vendor_after = Vendor.objects.get(handle__iexact=handle)
    assert vendor_after.verification_status == vendor_before.verification_status
    assert vendor_after.verified_at == vendor_before.verified_at
