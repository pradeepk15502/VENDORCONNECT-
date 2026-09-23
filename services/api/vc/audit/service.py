import hashlib

from django.conf import settings

from .models import AuditLog


def hash_ip(ip: str | None) -> str:
    if not ip:
        return ""
    return hashlib.sha256(f"{settings.SECRET_KEY}:{ip}".encode()).hexdigest()


def client_ip(request) -> str | None:
    # Behind a trusted proxy the platform sets X-Forwarded-For; take the left-most.
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")


def record(action: str, *, request=None, actor=None, target=None, role: str = "", **metadata) -> AuditLog:
    actor = actor or (request.user if request is not None and request.user.is_authenticated else None)
    return AuditLog.objects.create(
        actor=actor,
        actor_role=role,
        action=action,
        target_type=target.__class__.__name__.lower() if target is not None else "",
        target_id=str(target.pk) if target is not None else "",
        metadata=metadata,
        ip_hash=hash_ip(client_ip(request)) if request is not None else "",
        request_id=getattr(request, "request_id", "") if request is not None else "",
    )
