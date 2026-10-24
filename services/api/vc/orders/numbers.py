"""Human-friendly order numbers: VC-XXXXXX. Same collision-retry shape as vendors/handles.py's
handle generation — a unique DB constraint is the real guarantee, this just keeps a normal 201
response in the near-impossible case two requests picked the same code at once."""

import secrets

from django.db import IntegrityError

# No 0/O/1/I — avoids a customer misreading their own order number when reading it aloud to a vendor.
_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_LENGTH = 6
_ATTEMPTS = 8


def _candidate() -> str:
    return "VC-" + "".join(secrets.choice(_ALPHABET) for _ in range(_LENGTH))


def create_order_with_number(**fields):
    """Create the Order, retrying with a fresh number on a (near-impossible) collision."""
    from .models import Order

    last_error: Exception | None = None
    for _ in range(_ATTEMPTS):
        try:
            return Order.objects.create(number=_candidate(), **fields)
        except IntegrityError as exc:
            last_error = exc
    raise last_error  # pragma: no cover
