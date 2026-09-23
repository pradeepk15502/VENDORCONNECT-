from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from vc.accounts import otp
from vc.accounts.models import OtpChallenge
from vc.core.exceptions import DomainError

PHONE = "+919000000001"
pytestmark = pytest.mark.django_db


def _age(challenge, seconds):
    OtpChallenge.objects.filter(pk=challenge.pk).update(created_at=timezone.now() - timedelta(seconds=seconds))


@override_settings(OTP_RESEND_COOLDOWN_SECONDS=0)
def test_code_is_hashed_not_stored():
    issued = otp.issue_otp(PHONE)
    row = OtpChallenge.objects.get(pk=issued.challenge.pk)
    assert issued.code not in row.code_hash and len(row.code_hash) == 64
    assert len(issued.code) == 6 and issued.code.isdigit()


def test_verify_success_consumes_code():
    issued = otp.issue_otp(PHONE)
    otp.verify_otp(PHONE, issued.code)
    with pytest.raises(DomainError):  # single use
        otp.verify_otp(PHONE, issued.code)


def test_wrong_code_counts_attempts_then_locks():
    issued = otp.issue_otp(PHONE)
    wrong = "000000" if issued.code != "000000" else "111111"
    for _ in range(5):
        with pytest.raises(DomainError) as e:
            otp.verify_otp(PHONE, wrong)
        assert e.value.error_code == "otp_invalid"
    with pytest.raises(DomainError) as e:
        otp.verify_otp(PHONE, issued.code)  # even the right code is refused after lockout
    assert e.value.error_code == "otp_locked"


def test_expired_code_rejected():
    issued = otp.issue_otp(PHONE)
    OtpChallenge.objects.filter(pk=issued.challenge.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    with pytest.raises(DomainError):
        otp.verify_otp(PHONE, issued.code)


@override_settings(OTP_RESEND_COOLDOWN_SECONDS=30)
def test_resend_cooldown():
    otp.issue_otp(PHONE)
    with pytest.raises(DomainError) as e:
        otp.issue_otp(PHONE)
    assert e.value.error_code == "otp_cooldown" and e.value.status_code == 429


@override_settings(OTP_MAX_PER_PHONE_PER_HOUR=3)
def test_hourly_cap():
    for _ in range(3):
        c = otp.issue_otp(PHONE)
        _age(c.challenge, 60)
    with pytest.raises(DomainError) as e:
        otp.issue_otp(PHONE)
    assert e.value.error_code == "otp_rate_limited"


def test_only_newest_code_valid():
    first = otp.issue_otp(PHONE)
    _age(first.challenge, 60)
    second = otp.issue_otp(PHONE)
    if first.code != second.code:
        with pytest.raises(DomainError):
            otp.verify_otp(PHONE, first.code)
    otp.verify_otp(PHONE, second.code)
