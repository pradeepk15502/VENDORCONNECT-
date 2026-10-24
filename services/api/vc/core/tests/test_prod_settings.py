"""Phase 12 hardening: `config.settings.prod` refuses to start with unsafe configuration. These
import the settings module directly (rather than going through `django.conf.settings`, which is
already configured for the test run) so the refusal logic itself gets exercised, not just read."""

import importlib
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured


def _load_prod_settings(monkeypatch, **env):
    defaults = {
        "DJANGO_SECRET_KEY": "x" * 60,
        "OTP_DEV_ECHO": "false",
        "SMS_PROVIDER": "msg91",
    }
    for key, value in {**defaults, **env}.items():
        monkeypatch.setenv(key, value)
    # `base`/`prod` are plain modules with module-level side effects (env parsing, the
    # ImproperlyConfigured checks, structlog configuration) — re-running them under different env
    # vars requires dropping the cached modules first, or Python just returns the already-imported
    # (and already-validated) one.
    for name in ("config.settings.base", "config.settings.prod"):
        sys.modules.pop(name, None)
    return importlib.import_module("config.settings.prod")


@pytest.fixture(autouse=True)
def _isolate_settings_modules():
    """Restore whatever was cached in sys.modules before this test, so reloading `base`/`prod` here
    can't leak a mutated module into any test that runs after this file."""
    saved = {name: sys.modules.get(name) for name in ("config.settings.base", "config.settings.prod")}
    yield
    for name, mod in saved.items():
        if mod is not None:
            sys.modules[name] = mod
        else:
            sys.modules.pop(name, None)


def test_prod_refuses_console_sms_even_when_environment_var_says_development(monkeypatch):
    """The bug this closes: the refusal used to also require `ENVIRONMENT == "production"`, a
    separate env var from the one that actually selects this settings module. Loading `prod.py` at
    all (via DJANGO_SETTINGS_MODULE) is already the real signal that this is production/staging —
    gating the check on a second, independently-set variable meant SMS_PROVIDER=console could reach
    a real deployment simply by leaving ENVIRONMENT unset/"development"."""
    with pytest.raises(ImproperlyConfigured, match="SMS_PROVIDER=console"):
        _load_prod_settings(monkeypatch, SMS_PROVIDER="console", ENVIRONMENT="development")


def test_prod_refuses_console_sms_with_environment_unset(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with pytest.raises(ImproperlyConfigured, match="SMS_PROVIDER=console"):
        _load_prod_settings(monkeypatch, SMS_PROVIDER="console")


def test_prod_allows_a_real_sms_provider(monkeypatch):
    settings = _load_prod_settings(monkeypatch, SMS_PROVIDER="msg91")
    assert settings.SMS_PROVIDER == "msg91"
    assert settings.DEBUG is False


def test_prod_still_refuses_weak_secret_key(monkeypatch):
    with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY"):
        _load_prod_settings(monkeypatch, DJANGO_SECRET_KEY="dev-insecure-change-me")


def test_prod_still_refuses_otp_dev_echo(monkeypatch):
    with pytest.raises(ImproperlyConfigured, match="OTP_DEV_ECHO"):
        _load_prod_settings(monkeypatch, OTP_DEV_ECHO="true")


def test_prod_refuses_s3_backend_without_a_bucket_name(monkeypatch):
    """Phase 13: MEDIA_STORAGE_BACKEND=s3 with no bucket configured would otherwise fail at the
    first upload with a confusing boto3 error, far from the actual misconfiguration."""
    with pytest.raises(ImproperlyConfigured, match="AWS_STORAGE_BUCKET_NAME"):
        _load_prod_settings(monkeypatch, MEDIA_STORAGE_BACKEND="s3", AWS_STORAGE_BUCKET_NAME="")


def test_prod_allows_s3_backend_with_a_bucket_name(monkeypatch):
    settings = _load_prod_settings(monkeypatch, MEDIA_STORAGE_BACKEND="s3", AWS_STORAGE_BUCKET_NAME="vc-prod-media")
    assert settings.AWS_STORAGE_BUCKET_NAME == "vc-prod-media"
