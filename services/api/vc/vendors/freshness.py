from datetime import datetime

from django.conf import settings
from django.utils import timezone


def freshness(updated_at: datetime | None, category=None) -> str:
    """fresh | aging | stale — never present stale info as current (ARCHITECTURE D9)."""
    if updated_at is None:
        return "stale"
    aging = (category and category.freshness_aging_hours) or settings.FRESHNESS_AGING_HOURS
    stale = (category and category.freshness_stale_hours) or settings.FRESHNESS_STALE_HOURS
    hours = (timezone.now() - updated_at).total_seconds() / 3600
    if hours >= stale:
        return "stale"
    if hours >= aging:
        return "aging"
    return "fresh"
