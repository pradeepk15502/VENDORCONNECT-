"""Phase 11 — admin user management (master prompt §6/§7): list/detail/suspend/restore, gated by
`IsStaffRole` (list/detail) and the specific `accounts.manage_users` permission (suspend/restore),
matching the existing moderation/AI admin surfaces' coarse/fine-grained split exactly."""

import pytest
from django.contrib.auth.models import Permission
from rest_framework.test import APIClient

from vc.accounts.models import User
from vc.audit.models import AuditLog

pytestmark = pytest.mark.django_db

USERS = "/api/v1/admin/users"
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


def test_customer_cannot_list_users(api, customer):
    assert api.get(USERS).status_code == 403


def test_vendor_cannot_list_users(vendor_client):
    assert vendor_client.get(USERS).status_code == 403


def test_staff_role_alone_can_list_but_not_suspend(customer):
    staff, _ = _staff_login("+919888100001", roles=("support",))
    assert staff.get(USERS).status_code == 200  # IsStaffRole only
    r = staff.post(f"{USERS}/{customer.id}/suspend", {"reason": "test"}, format="json")
    assert r.status_code == 403  # lacks accounts.manage_users


# --- listing / search / filter -----------------------------------------------------------------


def test_admin_can_list_and_search_users_by_name_or_phone(customer):
    superuser, _ = _superuser_login("+919888100002")
    r = superuser.get(USERS)
    assert r.status_code == 200, r.content
    assert any(u["id"] == str(customer.id) for u in r.json()["results"])

    by_name = superuser.get(USERS, {"q": "Asha"})
    assert any(u["id"] == str(customer.id) for u in by_name.json()["results"])

    by_phone = superuser.get(USERS, {"q": "9876543210"})
    assert any(u["id"] == str(customer.id) for u in by_phone.json()["results"])

    no_match = superuser.get(USERS, {"q": "nobody-matches-this"})
    assert no_match.json()["count"] == 0


def test_admin_can_filter_users_by_role_and_active(vendor_client, customer):
    superuser, _ = _superuser_login("+919888100003")
    vendors_only = superuser.get(USERS, {"role": "vendor"})
    assert vendors_only.json()["count"] >= 1
    assert all("vendor" in u["roles"] for u in vendors_only.json()["results"])

    active_only = superuser.get(USERS, {"is_active": "true"})
    assert all(u["is_active"] for u in active_only.json()["results"])


def test_user_list_never_exposes_password_or_token_fields(customer):
    superuser, _ = _superuser_login("+919888100004")
    row = next(u for u in superuser.get(USERS).json()["results"] if u["id"] == str(customer.id))
    for forbidden in ("password", "otp", "token", "access", "refresh"):
        assert forbidden not in row


def test_user_detail_shows_vendor_association_and_counts(vendor_client, customer):
    handle = vendor_client.get("/api/v1/vendors/me").json()["handle"]
    owner = User.objects.get(vendors__handle=handle)
    superuser, _ = _superuser_login("+919888100005")

    r = superuser.get(f"{USERS}/{owner.id}")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["vendor"]["handle"] == handle
    assert body["order_count"] == 0
    assert body["reports_filed_count"] == 0


# --- suspend / restore -----------------------------------------------------------------------


def test_admin_can_suspend_and_restore_a_user(customer):
    staff, user = _staff_login("+919888100006", roles=("admin",))
    _grant(user, "manage_users")

    r = staff.post(f"{USERS}/{customer.id}/suspend", {"reason": "policy violation"}, format="json")
    assert r.status_code == 200, r.content
    assert r.json()["is_active"] is False
    assert r.json()["suspension_reason"] == "policy violation"
    customer.refresh_from_db()
    assert customer.is_active is False and customer.suspended_at is not None

    r2 = staff.post(f"{USERS}/{customer.id}/restore", format="json")
    assert r2.status_code == 200
    assert r2.json()["is_active"] is True
    customer.refresh_from_db()
    assert customer.is_active is True and customer.suspended_at is None and customer.suspension_reason == ""


def test_suspend_requires_a_reason(customer):
    staff, user = _staff_login("+919888100007", roles=("admin",))
    _grant(user, "manage_users")
    r = staff.post(f"{USERS}/{customer.id}/suspend", {}, format="json")
    assert r.status_code == 400


def test_admin_cannot_suspend_their_own_account():
    staff, user = _staff_login("+919888100008", roles=("admin",))
    _grant(user, "manage_users")
    r = staff.post(f"{USERS}/{user.id}/suspend", {"reason": "oops"}, format="json")
    assert r.status_code == 400
    user.refresh_from_db()
    assert user.is_active is True


def test_suspended_user_cannot_log_in():
    staff, user = _staff_login("+919888100009", roles=("admin",))
    _grant(user, "manage_users")
    target = User.objects.create_user("+919888199999", roles=["customer"])
    staff.post(f"{USERS}/{target.id}/suspend", {"reason": "test"}, format="json")

    blocked = APIClient()
    r = blocked.post("/api/v1/auth/otp/request", {"phone": target.phone}, format="json")
    otp = r.json()["dev_otp"]
    r2 = blocked.post("/api/v1/auth/otp/verify", {"phone": target.phone, "code": otp}, format="json")
    assert r2.status_code == 403
    assert r2.json()["error"]["code"] == "account_suspended"


def test_suspend_and_restore_write_audit_log_entries(customer):
    staff, user = _staff_login("+919888100010", roles=("admin",))
    _grant(user, "manage_users")
    staff.post(f"{USERS}/{customer.id}/suspend", {"reason": "audit-check"}, format="json")
    staff.post(f"{USERS}/{customer.id}/restore", format="json")

    assert AuditLog.objects.filter(action="user.suspended", target_id=str(customer.id)).exists()
    assert AuditLog.objects.filter(action="user.restored", target_id=str(customer.id)).exists()


# --- N+1 regression (Phase 12 hardening) --------------------------------------------------------


def test_user_list_query_count_does_not_scale_with_row_count(django_assert_max_num_queries):
    """AdminUserListSerializer.get_roles/get_vendor used to issue one query each per row
    (role_codes(), vendors.exclude(...).first()), so a page of N users was ~1 + 2N queries. The view
    now prefetches both, and the model/serializer read the prefetch cache instead of re-querying —
    so the query count must stay flat as the number of users (each with a role and a vendor) grows,
    not climb linearly."""
    superuser, _ = _superuser_login("+919888100011")

    def _make_vendor_owner(i):
        # Goes through the real onboarding endpoint (like the `vendor_client` fixture does) rather
        # than hand-rolling a `Vendor.objects.create(...)`, so this exercises the exact object graph
        # (including the related VendorLocation row) that AdminUserListSerializer.get_vendor sees in
        # production.
        owner_client = APIClient()
        phone = f"988810{5000 + i}"
        r = owner_client.post("/api/v1/auth/otp/request", {"phone": phone}, format="json")
        assert r.status_code == 200, r.content
        r2 = owner_client.post(
            "/api/v1/auth/otp/verify",
            {"phone": phone, "code": r.json()["dev_otp"], "name": f"Query Count Owner {i}"},
            format="json",
        )
        assert r2.status_code == 200, r2.content
        owner_client.credentials(HTTP_AUTHORIZATION=f"Bearer {r2.json()['access']}")
        shop = {
            "shop_name": f"Query Count Store {i}",
            "category_slugs": ["vegetables"],
            "location": {
                "lat": 28.4595 + i * 0.001,
                "lng": 77.0266,
                "address_line": f"Shop {i}, Sector 14 Market",
                "city": "Gurugram",
                "pincode": "122001",
            },
        }
        r3 = owner_client.post("/api/v1/vendors", shop, format="json")
        assert r3.status_code == 201, r3.content

    for i in range(3):
        _make_vendor_owner(i)

    # Whatever this costs for a handful of rows, it must not grow when more rows are added below —
    # that's the actual regression signal, not the absolute number.
    with django_assert_max_num_queries(10) as first:
        r1 = superuser.get(USERS, {"page_size": 50})
    assert r1.status_code == 200
    baseline_queries = len(first.captured_queries)

    for i in range(3, 8):
        _make_vendor_owner(i)

    with django_assert_max_num_queries(baseline_queries) as second:
        r2 = superuser.get(USERS, {"page_size": 50})
    assert r2.status_code == 200
    assert len(r2.json()["results"]) >= 9  # superuser + 8 vendor owners
    assert len(second.captured_queries) <= baseline_queries
