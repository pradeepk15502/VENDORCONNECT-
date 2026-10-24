"""Phase 12 hardening: logging duplication fix + CORS-exposed request-correlation header."""

import logging

from rest_framework.test import APIClient


def test_django_logger_does_not_double_emit():
    """Without an explicit `LOGGING["loggers"]["django"]` entry, Django's own `DEFAULT_LOGGING`
    handlers stay attached to the "django" logger *and* it keeps propagating to root's handler too
    — so anything logged through django.request/django.security (unhandled exceptions, 404s, CSRF
    failures) came out twice: once as Django's raw unformatted text, once as the real structured
    line. `propagate=False` plus this project's own "default" handler is the fix."""
    django_logger = logging.getLogger("django")
    assert django_logger.propagate is False
    assert [type(h).__name__ for h in django_logger.handlers] == ["StreamHandler"]


def test_cors_exposes_request_id_header(settings):
    """A cross-origin SPA can't read a response header via fetch/axios unless the server explicitly
    exposes it — without CORS_EXPOSE_HEADERS, `RequestIdMiddleware`'s X-Request-ID was only ever
    usable server-side, even though it exists precisely to help correlate a client-visible issue
    with the right server-side logs."""
    settings.CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]
    r = APIClient().get("/health", HTTP_ORIGIN="http://localhost:5173")
    assert r.status_code == 200
    assert r["Access-Control-Expose-Headers"] == "X-Request-ID"
