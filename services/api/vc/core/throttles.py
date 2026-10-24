"""Throttle scopes shared across more than one app (Phase 12 hardening, docs/ARCHITECTURE.md D33).
App-specific throttles (OTP: vc/accounts/throttles.py; AI detection: vc/ai/views.py; media upload:
vc/assets/views.py; chat messages: vc/chat/views.py) stay defined next to the view they guard —
this module exists only for the one scope reused by more than one app."""

from rest_framework.throttling import UserRateThrottle


class ReportSubmitThrottle(UserRateThrottle):
    """Any authenticated user can report a post, review or chat, with no relationship to the target
    required and no cooldown on repeat reports against the same one — a real harassment/brigading
    vector (spam-reporting a rival vendor's content, or burying the moderation queue) that ownership
    checks don't touch, since filing a report doesn't require any ownership at all."""

    scope = "report_submit"
