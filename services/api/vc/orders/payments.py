"""Payment provider abstraction (Phase 8, ARCHITECTURE D29).

`MockPaymentProvider` is a clearly-labelled, dev/test-safe stand-in — it never claims to be a real
gateway (`provider="mock"` on every `Payment` row it touches) and it never fakes a successful real
payment: cash is never "charged" at all (collected on handover), and UPI/online can be told to fail
via `simulate_failure`, a field the checkout serializer only accepts outside production. Swapping in
a real gateway later means writing one more class satisfying `PaymentProvider` and changing
`get_payment_provider()` — `views.py` never talks to a provider except through this interface.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol

from .models import Order, Payment

METHOD_CASH, METHOD_UPI, METHOD_ONLINE = "cash", "upi", "online"
METHOD_CHOICES = [METHOD_CASH, METHOD_UPI, METHOD_ONLINE]


@dataclass(frozen=True)
class PaymentResult:
    ok: bool
    status: str  # "pending" | "succeeded" | "failed"
    provider: str
    provider_ref: str
    message: str = ""


class PaymentProvider(Protocol):
    def charge(self, *, order: Order, method: str, simulate_failure: bool = False) -> PaymentResult: ...

    def refund(self, payment: Payment) -> PaymentResult: ...


class MockPaymentProvider:
    """Dev/test-only. Cash is collected on handover, so it is recorded as `pending`, never charged
    here. UPI/online "succeed" instantly (there is no real gateway configured) unless the caller
    asked to simulate a failure — the one lever the checkout edge-case tests and the frontend's own
    dev tools use to exercise the failure path honestly, instead of a path that can never be hit."""

    name = "mock"

    def charge(self, *, order: Order, method: str, simulate_failure: bool = False) -> PaymentResult:
        if method == METHOD_CASH:
            return PaymentResult(True, "pending", self.name, "", "Pay on handover.")
        if simulate_failure:
            return PaymentResult(False, "failed", self.name, "", "Payment could not be completed. Please try again.")
        return PaymentResult(True, "succeeded", self.name, f"mock_{uuid.uuid4().hex[:16]}", "Payment received.")

    def refund(self, payment: Payment) -> PaymentResult:
        return PaymentResult(True, "refunded", self.name, payment.provider_ref, "Refunded.")


def get_payment_provider() -> PaymentProvider:
    """No real gateway is configured for this project yet (ARCHITECTURE D29) — always the mock."""
    return MockPaymentProvider()
