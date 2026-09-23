"""Uniform error envelope:

{"error": {"code": "validation_error", "message": "...", "details": {...}}}
"""

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class DomainError(exceptions.APIException):
    """Business-rule violation that the client can act on."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "domain_error"
    default_detail = "Request could not be completed."

    def __init__(self, message=None, code=None, status_code=None, details=None):
        self.error_code = code or self.default_code
        super().__init__(message or self.default_detail, self.error_code)
        if status_code:
            self.status_code = status_code
        self.details = details or {}


def _code_for(exc) -> str:
    if isinstance(exc, DomainError):
        return exc.error_code
    if isinstance(exc, exceptions.ValidationError):
        return "validation_error"
    if isinstance(exc, exceptions.NotAuthenticated):
        return "not_authenticated"
    if isinstance(exc, exceptions.AuthenticationFailed):
        return "authentication_failed"
    if isinstance(exc, exceptions.PermissionDenied):
        return "permission_denied"
    if isinstance(exc, exceptions.NotFound):
        return "not_found"
    if isinstance(exc, exceptions.Throttled):
        return "rate_limited"
    if isinstance(exc, exceptions.MethodNotAllowed):
        return "method_not_allowed"
    return getattr(exc, "default_code", "error")


def exception_handler(exc, context):
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()
    response = drf_exception_handler(exc, context)
    if response is None:
        return None  # unhandled -> 500 via Django (logged)

    code = _code_for(exc)
    if isinstance(exc, exceptions.ValidationError):
        message = "Some fields are invalid."
        details = response.data
    else:
        detail = response.data.get("detail") if isinstance(response.data, dict) else response.data
        message = str(detail) if detail is not None else str(exc)
        details = getattr(exc, "details", {}) or {}
        if isinstance(exc, exceptions.Throttled) and exc.wait:
            details = {"retry_after_seconds": int(exc.wait)}
    body = {"error": {"code": code, "message": message, "details": details}}
    return Response(body, status=response.status_code, headers=_headers(response))


def _headers(response):
    return {k: v for k, v in response.items() if k in ("Retry-After", "WWW-Authenticate", "Allow")}
