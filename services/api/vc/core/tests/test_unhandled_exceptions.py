"""Phase 12 hardening: a genuinely unhandled exception on the API surface must still return this
project's uniform {"error": {...}} envelope, not Django's default HTML error page."""

import pytest
from django.http import HttpResponse
from django.test import RequestFactory
from rest_framework.test import APIClient

from vc.catalog.views import CategoryListView
from vc.core.exceptions import handler500

pytestmark = pytest.mark.django_db


def test_unhandled_exception_on_api_route_returns_json_envelope(monkeypatch):
    def boom(self):
        raise RuntimeError("boom — this should never reach the client")

    monkeypatch.setattr(CategoryListView, "get_queryset", boom)
    client = APIClient(raise_request_exception=False)
    r = client.get("/api/v1/categories")

    assert r.status_code == 500
    assert r["Content-Type"].startswith("application/json")
    body = r.json()
    assert body["error"]["code"] == "server_error"
    # Never leak the real exception class/message/traceback to the client.
    assert "RuntimeError" not in body["error"]["message"]
    assert "boom" not in body["error"]["message"]
    assert "details" in body["error"]


def test_unhandled_exception_on_non_api_route_keeps_django_default_page(monkeypatch):
    """django-admin isn't part of the API's JSON contract — `handler500` must delegate to Django's
    own default error page for any path outside `/api/`, rather than forcing every route in the
    project onto the same JSON envelope. Exercised directly against `handler500` (rather than a live
    `/django-admin/...` request) since the admin's URLs are resolved once at startup, binding the
    real `login`/`index` methods before a test could monkeypatch them to fail."""
    request = RequestFactory().get("/django-admin/some-unhandled-error/")
    fallback = HttpResponse("django's own error page", status=500)
    monkeypatch.setattr("vc.core.exceptions.django_server_error", lambda req: fallback)

    r = handler500(request)

    assert r is fallback
    assert not r["Content-Type"].startswith("application/json")
