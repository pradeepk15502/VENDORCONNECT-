"""Order status state machine (Phase 8, ARCHITECTURE D29): one table drives the single
`POST /orders/{id}/transition` endpoint, instead of eight near-duplicate action endpoints. An
action not listed for the order's current status simply isn't in the table — "a rejected order
cannot become preparing" is true because there is no `("preparing", "rejected")` entry, not because
of an `if` that could drift out of sync between endpoints as new actions are added.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import Order

CUSTOMER, VENDOR = "customer", "vendor"


@dataclass(frozen=True)
class Rule:
    role: str  # who may perform this action
    to: str  # resulting status
    fulfilment: str | None = None  # None = allowed for either fulfilment type
    requires_reason: bool = False


# {action: {from_status: Rule}}
RULES: dict[str, dict[str, Rule]] = {
    "accept": {Order.S_PLACED: Rule(VENDOR, Order.S_ACCEPTED)},
    "reject": {Order.S_PLACED: Rule(VENDOR, Order.S_REJECTED, requires_reason=True)},
    "preparing": {Order.S_ACCEPTED: Rule(VENDOR, Order.S_PREPARING)},
    "ready": {Order.S_PREPARING: Rule(VENDOR, Order.S_READY)},
    "picked_up": {Order.S_READY: Rule(VENDOR, Order.S_PICKED_UP, fulfilment=Order.PICKUP)},
    "out_for_delivery": {Order.S_READY: Rule(VENDOR, Order.S_OUT, fulfilment=Order.DELIVERY)},
    "delivered": {Order.S_OUT: Rule(VENDOR, Order.S_DELIVERED, fulfilment=Order.DELIVERY)},
    "completed": {
        Order.S_PICKED_UP: Rule(VENDOR, Order.S_COMPLETED, fulfilment=Order.PICKUP),
        Order.S_DELIVERED: Rule(VENDOR, Order.S_COMPLETED, fulfilment=Order.DELIVERY),
    },
    # Customer cancellation is only allowed before the vendor has acted at all (master prompt's
    # explicit rule) — everything past "placed" requires talking to the vendor (chat), not a button.
    "cancel": {Order.S_PLACED: Rule(CUSTOMER, Order.S_CANCELLED)},
}

ACTIONS = list(RULES)

# Statuses a customer's "active orders" view should treat as done (Order History vs. Tracking).
TERMINAL_STATUSES = {Order.S_REJECTED, Order.S_CANCELLED, Order.S_COMPLETED}


class InvalidTransition(Exception):
    def __init__(self, message: str, code: str = "invalid_transition"):
        self.message = message
        self.code = code
        super().__init__(message)


def check(order: Order, action: str, role: str) -> Rule:
    """Validates `action` against the order's current state; returns the matching Rule or raises
    `InvalidTransition`. Callers still own applying the state change — this only decides if it's
    allowed, so it stays trivially testable without touching the database."""
    rules_for_action = RULES.get(action)
    if rules_for_action is None:
        raise InvalidTransition(f"Unknown action '{action}'.", code="unknown_action")
    rule = rules_for_action.get(order.status)
    if rule is None:
        raise InvalidTransition(
            f"Order is '{order.status}'; '{action}' is not valid from there.", code="invalid_transition"
        )
    if rule.role != role:
        raise InvalidTransition(f"Only the {rule.role} can do that.", code="permission_denied")
    if rule.fulfilment is not None and order.fulfilment != rule.fulfilment:
        raise InvalidTransition(f"'{action}' only applies to {rule.fulfilment} orders.", code="invalid_transition")
    return rule
