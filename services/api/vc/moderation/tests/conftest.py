"""Reuses the Phase 8 order fixtures (`listing`, `open_vendor`, ...) for setting up posts/reviews
to moderate. See vc/social/tests/conftest.py for why this imports rather than uses `pytest_plugins`."""

from vc.orders.tests.conftest import address, cart_with_item, far_address, listing, open_vendor  # noqa: F401
