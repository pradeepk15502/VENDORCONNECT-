import pytest
from django.conf import settings
from rest_framework.test import APIClient

from conftest import login
from vc.accounts.models import User
from vc.audit.models import AuditLog

pytestmark = pytest.mark.django_db
CSRF = {"HTTP_X_REQUESTED_WITH": "vendorconnect"}


def test_signup_creates_customer_and_returns_tokens(api):
    r = login(api, "9876500001", "Asha")
    body = r.json()
    assert body["is_new_user"] is True
    assert body["user"]["roles"] == ["customer"]
    assert body["user"]["name"] == "Asha"
    assert "refresh" not in body  # web clients get it only as HttpOnly cookie
    cookie = r.cookies[settings.REFRESH_COOKIE_NAME]
    assert cookie["httponly"] and cookie["path"] == "/api/v1/auth/"
    assert AuditLog.objects.filter(action="auth.login").exists()


def test_second_login_is_existing_user(api):
    login(api, "9876500002")
    r = login(APIClient(), "9876500002")
    assert r.json()["is_new_user"] is False
    assert User.objects.filter(phone="+919876500002").count() == 1


def test_invalid_phone_uses_error_envelope(api):
    r = api.post("/api/v1/auth/otp/request", {"phone": "12345"}, format="json")
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "validation_error" and "phone" in err["details"]


def test_wrong_code_rejected_with_attempts_remaining(api):
    api.post("/api/v1/auth/otp/request", {"phone": "9876500003"}, format="json")
    r = api.post("/api/v1/auth/otp/verify", {"phone": "9876500003", "code": "123"}, format="json")
    assert r.status_code == 400  # format validation
    r = api.post("/api/v1/auth/otp/verify", {"phone": "9876500003", "code": "999999"}, format="json")
    if r.status_code == 400:
        assert r.json()["error"]["code"] == "otp_invalid"
        assert r.json()["error"]["details"]["attempts_remaining"] == 4


def test_me_requires_auth_and_can_update(api):
    assert api.get("/api/v1/auth/me").json()["error"]["code"] == "not_authenticated"
    login(api, "9876500004")
    r = api.patch("/api/v1/auth/me", {"name": "Ravi", "language": "hi", "phone": "+910000000000"}, format="json")
    assert r.status_code == 200
    assert r.json()["name"] == "Ravi" and r.json()["language"] == "hi"
    assert r.json()["phone"] == "+919876500004"  # phone is read-only


def test_refresh_cookie_requires_csrf_header_and_rotates(api):
    login(api, "9876500005")
    api.credentials()
    assert api.post("/api/v1/auth/token/refresh").status_code == 403  # missing header
    old_cookie = api.cookies[settings.REFRESH_COOKIE_NAME].value
    r = api.post("/api/v1/auth/token/refresh", **CSRF)
    assert r.status_code == 200 and "access" in r.json()
    assert api.cookies[settings.REFRESH_COOKIE_NAME].value != old_cookie
    # replaying the old (rotated, blacklisted) token fails
    replay = APIClient()
    replay.cookies[settings.REFRESH_COOKIE_NAME] = old_cookie
    assert replay.post("/api/v1/auth/token/refresh", **CSRF).status_code == 401


def test_native_refresh_in_body():
    c = APIClient()
    r = login(c, "9876500006", refresh_in_body=True)
    refresh = r.json()["refresh"]
    r2 = APIClient().post("/api/v1/auth/token/refresh", {"refresh": refresh}, format="json")
    assert r2.status_code == 200 and "refresh" in r2.json()


def test_logout_blacklists_refresh(api):
    login(api, "9876500007")
    cookie = api.cookies[settings.REFRESH_COOKIE_NAME].value
    assert api.post("/api/v1/auth/logout", **CSRF).status_code == 204
    c = APIClient()
    c.cookies[settings.REFRESH_COOKIE_NAME] = cookie
    assert c.post("/api/v1/auth/token/refresh", **CSRF).status_code == 401


def test_suspended_user_cannot_login(api):
    login(APIClient(), "9876500008")
    User.objects.filter(phone="+919876500008").update(is_active=False)
    r = api.post("/api/v1/auth/otp/request", {"phone": "9876500008"}, format="json")
    r = api.post("/api/v1/auth/otp/verify", {"phone": "9876500008", "code": r.json()["dev_otp"]}, format="json")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_suspended"


def test_admin_requires_password_plus_otp(api):
    admin = User.objects.create_superuser("+919876500009", "correct-horse-battery")
    # plain OTP login gives a normal session → admin API denied
    c = APIClient()
    login(c, "9876500009")
    assert c.get("/api/v1/admin/whoami").status_code == 403
    # wrong password
    r = api.post("/api/v1/auth/admin/password", {"phone": "9876500009", "password": "nope"}, format="json")
    assert r.status_code == 401
    # password → OTP(purpose=admin) → admin session
    api2 = APIClient()
    from vc.accounts.models import OtpChallenge

    OtpChallenge.objects.filter(phone=admin.phone).delete()  # skip resend cooldown from the plain login above
    r = api2.post(
        "/api/v1/auth/admin/password", {"phone": "9876500009", "password": "correct-horse-battery"}, format="json"
    )
    assert r.status_code == 200
    r = api2.post(
        "/api/v1/auth/otp/verify",
        {"phone": "9876500009", "code": r.json()["dev_otp"], "purpose": "admin"},
        format="json",
    )
    assert r.status_code == 200
    api2.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
    assert api2.get("/api/v1/admin/whoami").status_code == 200


def test_admin_purpose_rejected_for_non_staff(api):
    login(APIClient(), "9876500010")
    from vc.accounts import otp
    from vc.accounts.models import OtpChallenge

    OtpChallenge.objects.all().delete()
    issued = otp.issue_otp("+919876500010", purpose="admin")
    r = api.post(
        "/api/v1/auth/otp/verify", {"phone": "9876500010", "code": issued.code, "purpose": "admin"}, format="json"
    )
    assert r.status_code == 403
