"""Msg91SmsProvider against a mocked `requests.post` — proves the request shape and both success
and failure handling, without a real MSG91 account or network access."""

import pytest
import requests

from vc.accounts.sms import Msg91SmsProvider


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._json = json_body or {}
        self.content = b"1" if json_body is not None else b""

    def json(self):
        return self._json


@pytest.fixture
def configured(settings):
    settings.MSG91_AUTH_KEY = "test-auth-key"
    settings.MSG91_OTP_TEMPLATE_ID = "test-template-id"


def test_raises_when_not_configured(settings):
    settings.MSG91_AUTH_KEY = ""
    settings.MSG91_OTP_TEMPLATE_ID = ""
    with pytest.raises(RuntimeError, match="not configured"):
        Msg91SmsProvider().send_otp("+919000000001", "123456", 5)


def test_sends_the_caller_supplied_code_with_expected_shape(configured, monkeypatch):
    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(200, {"type": "success", "message": "sent"})

    monkeypatch.setattr(requests, "post", fake_post)
    Msg91SmsProvider().send_otp("+919000000001", "123456", 5)

    assert captured["url"] == "https://control.msg91.com/api/v5/otp"
    assert captured["headers"]["authkey"] == "test-auth-key"
    assert captured["json"] == {
        "template_id": "test-template-id",
        "mobile": "919000000001",
        "otp": "123456",
        "otp_expiry": 5,
    }
    assert captured["timeout"] == 10


def test_raises_on_provider_error_body_even_with_http_200(configured, monkeypatch):
    monkeypatch.setattr(
        requests, "post", lambda *a, **k: _FakeResponse(200, {"type": "error", "message": "invalid template"})
    )
    with pytest.raises(RuntimeError, match="invalid template"):
        Msg91SmsProvider().send_otp("+919000000001", "123456", 5)


def test_raises_on_non_2xx_status(configured, monkeypatch):
    monkeypatch.setattr(requests, "post", lambda *a, **k: _FakeResponse(401, {"message": "bad auth key"}))
    with pytest.raises(RuntimeError, match="SMS provider rejected"):
        Msg91SmsProvider().send_otp("+919000000001", "123456", 5)


def test_raises_cleanly_on_network_failure(configured, monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError("no route to host")

    monkeypatch.setattr(requests, "post", boom)
    with pytest.raises(RuntimeError, match="Failed to reach"):
        Msg91SmsProvider().send_otp("+919000000001", "123456", 5)


def test_never_logs_the_otp_code(configured, monkeypatch, caplog):
    monkeypatch.setattr(requests, "post", lambda *a, **k: _FakeResponse(200, {"type": "success"}))
    Msg91SmsProvider().send_otp("+919000000001", "secret-code-999", 5)
    assert "secret-code-999" not in caplog.text
