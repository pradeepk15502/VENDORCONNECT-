"""Phase 12 hardening: sending is rate-limited separately from reading (polling stays fast), and
filing a chat report is rate-limited too — ownership checks alone don't cap volume between two
already-authenticated parties."""

import pytest

from vc.chat.views import ChatMessagesView

from .test_chat import CHATS, start_chat, vendor_handle  # noqa: F401 (vendor_handle re-exported)

pytestmark = pytest.mark.django_db


def test_sending_messages_is_rate_limited_but_reading_is_not(monkeypatch, api, customer, vendor_client):
    from vc.chat.views import ChatMessageThrottle

    monkeypatch.setattr(ChatMessageThrottle, "rate", "1/min", raising=False)
    chat_id = start_chat(api, vendor_handle(vendor_client))

    first = api.post(f"{CHATS}/{chat_id}/messages", {"text": "hello"}, format="json")
    assert first.status_code == 201, first.content

    second = api.post(f"{CHATS}/{chat_id}/messages", {"text": "hello again"}, format="json")
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limited"

    # Reading/polling is a different HTTP method on the same view and must not share the send scope.
    polled = api.get(f"{CHATS}/{chat_id}/messages")
    assert polled.status_code == 200


def test_get_throttles_only_scopes_post(monkeypatch):
    """Direct check of the method-based scoping (ARCHITECTURE.md D33), independent of timing."""
    view = ChatMessagesView()
    view.request = type("R", (), {"method": "POST"})()
    assert [type(t).__name__ for t in view.get_throttles()] == ["ChatMessageThrottle"]
    view.request = type("R", (), {"method": "GET"})()
    assert "ChatMessageThrottle" not in [type(t).__name__ for t in view.get_throttles()]


def test_chat_report_is_rate_limited(monkeypatch, api, customer, vendor_client):
    from vc.core.throttles import ReportSubmitThrottle

    monkeypatch.setattr(ReportSubmitThrottle, "rate", "1/hour", raising=False)
    chat_id = start_chat(api, vendor_handle(vendor_client))

    first = api.post(f"{CHATS}/{chat_id}/report", {"reason": "spam", "details": ""}, format="json")
    assert first.status_code == 201, first.content

    second = api.post(f"{CHATS}/{chat_id}/report", {"reason": "spam", "details": ""}, format="json")
    assert second.status_code == 429
