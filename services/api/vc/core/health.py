import time

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

_STARTED = time.time()


def health(request):
    """Liveness: process is up. Cheap, no dependencies."""
    return JsonResponse({"status": "ok", "service": "api", "environment": settings.ENVIRONMENT})


def ready(request):
    """Readiness: database (with PostGIS) and cache reachable."""
    checks = {}
    ok = True
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT postgis_lib_version()")
            checks["database"] = {"status": "ok", "postgis": cur.fetchone()[0]}
    except Exception as exc:  # noqa: BLE001
        ok = False
        checks["database"] = {"status": "error", "error": exc.__class__.__name__}
    try:
        cache.set("health:ping", "1", 5)
        checks["cache"] = {"status": "ok" if cache.get("health:ping") == "1" else "error"}
        ok = ok and checks["cache"]["status"] == "ok"
    except Exception as exc:  # noqa: BLE001
        ok = False
        checks["cache"] = {"status": "error", "error": exc.__class__.__name__}
    return JsonResponse(
        {"status": "ok" if ok else "degraded", "uptime_s": int(time.time() - _STARTED), "checks": checks},
        status=200 if ok else 503,
    )
