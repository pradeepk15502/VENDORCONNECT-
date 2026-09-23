import time
import uuid

import structlog

log = structlog.get_logger("vc.access")


class RequestIdMiddleware:
    """Attach a request id (incoming X-Request-ID or generated) to logs and response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get("X-Request-ID", "")
        rid = incoming if (0 < len(incoming) <= 64 and incoming.replace("-", "").isalnum()) else uuid.uuid4().hex
        request.request_id = rid
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=rid)
        response = self.get_response(request)
        response["X-Request-ID"] = rid
        return response


class AccessLogMiddleware:
    """One structured line per request. Never logs bodies, tokens or query strings (may hold location)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.perf_counter()
        response = self.get_response(request)
        if not request.path.startswith("/health"):
            user = getattr(request, "user", None)
            log.info(
                "request",
                method=request.method,
                path=request.path,
                status=response.status_code,
                duration_ms=round((time.perf_counter() - start) * 1000, 1),
                user_id=str(user.pk) if user is not None and user.is_authenticated else None,
            )
        return response
