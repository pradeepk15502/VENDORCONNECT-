"""Real notification rows, not fake frontend toasts (Phase 8, ARCHITECTURE D29). Every order event
that the master prompt lists calls `notify()` for whichever side didn't cause it. `NotificationPreference`
and `PushSubscription` (Phase 0 schema) aren't wired to any delivery channel yet — this only ever
writes the in-app `Notification` row; push/SMS fan-out is future work, not faked here."""

from .models import Notification


def notify(user, *, kind: str, title: str, body: str = "", data: dict | None = None) -> Notification:
    return Notification.objects.create(user=user, kind=kind, title=title, body=body, data=data or {})
