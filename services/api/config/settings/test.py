from .base import *  # noqa: F401,F403

DEBUG = False
OTP_DEV_ECHO = True
REFRESH_COOKIE_SECURE = False
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
REST_FRAMEWORK = {**REST_FRAMEWORK}  # noqa: F405
LOGGING["root"]["level"] = "WARNING"  # noqa: F405
SECRET_KEY = "test-secret-key-that-is-long-enough-for-hs256-signing-0123456789"  # nosec B105
SIMPLE_JWT = {**SIMPLE_JWT, "SIGNING_KEY": SECRET_KEY}  # noqa: F405
OTP_HMAC_KEY = SECRET_KEY
OTP_RESEND_COOLDOWN_SECONDS = 0
OTP_MAX_PER_PHONE_PER_HOUR = 50
