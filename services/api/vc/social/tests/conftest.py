"""Reuses the Phase 8 order fixtures (`listing`, `open_vendor`, `address`, ...) instead of
redefining them — Phase 9's review tests need a real completed order exactly like Phase 8's own
transition tests do.

Importing the already-`@pytest.fixture`-decorated functions here (rather than `pytest_plugins`,
which pytest no longer allows outside a top-level conftest) makes pytest discover them the same
way as if they were defined in this file."""

from vc.orders.tests.conftest import address, cart_with_item, far_address, listing, open_vendor  # noqa: F401
