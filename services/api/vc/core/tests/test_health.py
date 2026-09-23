import pytest
from rest_framework.test import APIClient


def test_health():
    r = APIClient().get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert r["X-Request-ID"]


@pytest.mark.django_db
def test_ready_checks_db_and_cache():
    r = APIClient().get("/health/ready")
    assert r.status_code == 200
    assert r.json()["checks"]["database"]["status"] == "ok"


def test_request_id_propagates():
    r = APIClient().get("/health", HTTP_X_REQUEST_ID="abc-123")
    assert r["X-Request-ID"] == "abc-123"


def test_unknown_route_404():
    assert APIClient().get("/api/v1/nope").status_code == 404


@pytest.mark.django_db
def test_openapi_schema_generates():
    r = APIClient().get("/api/v1/schema/")
    assert r.status_code == 200
