"""SMS delivery behind a small interface so providers can be swapped by env var.

Only `console` is implemented; real providers need credentials and DLT template
registration (mandatory for Indian SMS) and are intentionally stubbed.
"""

from __future__ import annotations

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


class Msg91SmsProvider(NotConfiguredSmsProvider):
    name = "msg91"


class TwilioSmsProvider(NotConfiguredSmsProvider):
    name = "twilio"


_PROVIDERS = {
    "console": "vc.accounts.sms.ConsoleSmsProvider",
    "msg91": "vc.accounts.sms.Msg91SmsProvider",
    "twilio": "vc.accounts.sms.TwilioSmsProvider",
}


def get_sms_provider() -> SmsProvider:
    return import_string(_PROVIDERS[settings.SMS_PROVIDER])()
