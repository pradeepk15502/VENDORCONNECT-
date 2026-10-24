"""SMS delivery behind a small interface so providers can be swapped by env var.

`console` (dev) and `msg91` are implemented. `msg91` still needs a real MSG91 account with
DLT registration completed (mandatory for any commercial/transactional SMS to Indian numbers —
a TRAI telecom regulation, not an MSG91-specific step) before it can actually deliver: register
as a Principal Entity with a DLT operator, get an OTP template approved, and put that template's
ID in MSG91_OTP_TEMPLATE_ID. None of that can be done from here — it's an account/compliance
step only the account owner can complete. `twilio` remains an intentional stub (not used for
this deployment).
"""

from __future__ import annotations

import requests
import structlog
from django.conf import settings
from django.utils.module_loading import import_string

log = structlog.get_logger("vc.sms")


class SmsProvider:
    def send_otp(self, phone: str, code: str, ttl_minutes: int) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class ConsoleSmsProvider(SmsProvider):
    """Dev/test: writes a masked line to the log. Never used in production (see prod settings)."""

    outbox: list[tuple[str, str]] = []

    def send_otp(self, phone, code, ttl_minutes):
        ConsoleSmsProvider.outbox.append((phone, code))
        del ConsoleSmsProvider.outbox[:-50]
        log.info("sms.console", to=phone[:3] + "******" + phone[-4:], message=f"VendorConnect code {code}")


class NotConfiguredSmsProvider(SmsProvider):
    name = "unconfigured"

    def send_otp(self, phone, code, ttl_minutes):
        raise RuntimeError(f"SMS provider '{self.name}' is not configured. Set credentials and implement the adapter.")


class Msg91SmsProvider(SmsProvider):
    """MSG91's "Send OTP (custom code)" API — we generate the code ourselves (vc/accounts/otp.py
    owns the HMAC-hashed challenge), MSG91 only delivers it, so this calls the variant of their
    OTP endpoint that accepts a caller-supplied `otp` rather than letting MSG91 generate one.

    Requires MSG91_AUTH_KEY (account auth key) and MSG91_OTP_TEMPLATE_ID (a DLT-approved
    transactional template containing the `##OTP##` variable) — see the module docstring for why
    the template can't be created from here. `phone` is expected in `+91XXXXXXXXXX` form (the
    only format `vc.accounts` issues challenges for); MSG91 wants the country code without `+`.
    """

    name = "msg91"
    _ENDPOINT = "https://control.msg91.com/api/v5/otp"

    def send_otp(self, phone: str, code: str, ttl_minutes: int) -> None:
        auth_key = settings.MSG91_AUTH_KEY
        template_id = settings.MSG91_OTP_TEMPLATE_ID
        if not auth_key or not template_id:
            raise RuntimeError(
                "SMS provider 'msg91' is not configured: MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID "
                "must both be set (see vc/accounts/sms.py for what each requires)."
            )
        masked = phone[:3] + "******" + phone[-4:]
        try:
            resp = requests.post(
                self._ENDPOINT,
                headers={"authkey": auth_key, "Content-Type": "application/json"},
                json={
                    "template_id": template_id,
                    "mobile": phone.lstrip("+"),
                    "otp": code,
                    "otp_expiry": ttl_minutes,
                },
                timeout=10,
            )
        except requests.RequestException as exc:
            log.error("sms.msg91.request_failed", to=masked, error=str(exc))
            raise RuntimeError("Failed to reach the SMS provider.") from exc
        # MSG91 returns HTTP 200 with {"type": "error", ...} for most failures (bad template,
        # DLT rejection, insufficient balance), not a non-2xx status — both forms are failures.
        body = resp.json() if resp.content else {}
        if not resp.ok or body.get("type") == "error":
            log.error("sms.msg91.send_failed", to=masked, status=resp.status_code, response=body)
            raise RuntimeError(f"SMS provider rejected the request: {body.get('message', resp.status_code)}")
        log.info("sms.msg91.sent", to=masked)


class TwilioSmsProvider(NotConfiguredSmsProvider):
    name = "twilio"


_PROVIDERS = {
    "console": "vc.accounts.sms.ConsoleSmsProvider",
    "msg91": "vc.accounts.sms.Msg91SmsProvider",
    "twilio": "vc.accounts.sms.TwilioSmsProvider",
}


def get_sms_provider() -> SmsProvider:
    return import_string(_PROVIDERS[settings.SMS_PROVIDER])()
