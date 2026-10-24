"""Phase 8 — the notification inbox (ARCHITECTURE D29). Order events themselves are exercised in
vc/orders/tests/test_orders.py; this covers the inbox endpoints on their own."""

import pytest
from rest_framework.test import APIClient

from .. import service
from ..models import Notification

pytestmark = pytest.mark.django_db

NOTIFICATIONS = "/api/v1/notifications"


def test_empty_inbox(api, customer):
    r = api.get(NOTIFICATIONS)
    assert r.status_code == 200
    assert r.json()["results"] == []
    assert r.json()["unread_count"] == 0


def test_list_shows_unread_count(api, customer):
    service.notify(customer, kind="order_status", title="Order ready", body="Come pick it up.")
    service.notify(customer, kind="order_status", title="Order completed")
    r = api.get(NOTIFICATIONS)
    assert r.json()["count"] == 2
    assert r.json()["unread_count"] == 2


def test_mark_one_read(api, customer):
    n = service.notify(customer, kind="order_status", title="Order ready")
    r = api.post(f"{NOTIFICATIONS}/{n.id}/read")
    assert r.status_code == 204
    assert Notification.objects.get(id=n.id).read_at is not None
    assert api.get(NOTIFICATIONS).json()["unread_count"] == 0


def test_mark_all_read(api, customer):
    service.notify(customer, kind="order_status", title="A")
    service.notify(customer, kind="order_status", title="B")
    r = api.post(f"{NOTIFICATIONS}/read-all")
    assert r.status_code == 204
    assert api.get(NOTIFICATIONS).json()["unread_count"] == 0


def test_cannot_mark_another_users_notification_read(api, customer):
    from conftest import login

    other = APIClient()
    login(other, "9555555555", "Bina")
    from vc.accounts.models import User

    bina = User.objects.get(phone="+919555555555")
    n = service.notify(bina, kind="order_status", title="For Bina only")

    r = api.post(f"{NOTIFICATIONS}/{n.id}/read")
    assert r.status_code == 404
    assert Notification.objects.get(id=n.id).read_at is None


def test_unauthenticated_request_is_rejected(db):
    assert APIClient().get(NOTIFICATIONS).status_code == 401
