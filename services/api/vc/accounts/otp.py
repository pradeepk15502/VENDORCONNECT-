import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status

from vc.core.exceptions import DomainError

from .models import OtpChallenge
from .sms import get_sms_provider


def _hash(challenge_id, code: str) -> str:
    msg = f"{challenge_id}:{code}".encode()
    return hmac.new(settings.OTP_HMAC_KEY.encode(), msg, hashlib.sha256).hexdigest()


def _generate_code() -> str:
    return f"{secrets.randbelow(10**settings.OTP_LENGTH):0{settings.OTP_LENGTH}d}"


@dataclass
class IssuedOtp:
    challenge: OtpChallenge
    code: str  # only returned to callers for dev echo; never logged/stored


def issue_otp(phone: str, purpose: str = OtpChallenge.PURPOSE_LOGIN, ip_hash: str = "") -> IssuedOtp:
    now = timezone.now()
    recent = OtpChallenge.objects.filter(phone=phone, created_at__gte=now - timedelta(hours=1))
    if recent.count() >= settings.OTP_MAX_PER_PHONE_PER_HOUR:
        raise DomainError(
            "Too many codes requested. Please try again later.",
            code="otp_rate_limited",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            details={"retry_after_seconds": 3600},
        )
    last = recent.order_by("-created_at").first()
    if last is not None:
        wait = settings.OTP_RESEND_COOLDOWN_SECONDS - (now - last.created_at).total_seconds()
        if wait > 0:
            raise DomainError(
                "Please wait before requesting another code.",
                code="otp_cooldown",
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                details={"retry_after_seconds": int(wait) + 1},
            )

    code = _generate_code()
    with transaction.atomic():
        # Invalidate earlier live codes so only the newest works.
        OtpChallenge.objects.filter(phone=phone, purpose=purpose, consumed_at__isnull=True).update(consumed_at=now)
        challenge = OtpChallenge(
            phone=phone,
            purpose=purpose,
            code_hash="",
            expires_at=now + timedelta(seconds=settings.OTP_TTL_SECONDS),
            ip_hash=ip_hash,
        )
        challenge.code_hash = _hash(challenge.id, code)
        challenge.save()
    get_sms_provider().send_otp(phone, code, settings.OTP_TTL_SECONDS // 60)
    return IssuedOtp(challenge=challenge, code=code)


_INVALID = "The code is incorrect or has expired."


def verify_otp(phone: str, code: str, purpose: str = OtpChallenge.PURPOSE_LOGIN) -> OtpChallenge:
    now = timezone.now()
    with transaction.atomic():
        challenge = (
            OtpChallenge.objects.select_for_update()
            .filter(phone=phone, purpose=purpose, consumed_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if challenge is None or challenge.expires_at <= now:
            raise DomainError(_INVALID, code="otp_invalid")
        if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
            raise DomainError("Too many wrong attempts. Request a new code.", code="otp_locked")
        challenge.attempts += 1
        ok = hmac.compare_digest(challenge.code_hash, _hash(challenge.id, str(code)))
        if ok:
            challenge.consumed_at = now
        challenge.save(update_fields=["attempts", "consumed_at", "updated_at"])
    if not ok:
        remaining = settings.OTP_MAX_ATTEMPTS - challenge.attempts
        raise DomainError(_INVALID, code="otp_invalid", details={"attempts_remaining": max(remaining, 0)})
    return challenge
