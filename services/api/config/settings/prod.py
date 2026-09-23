"""Production / staging settings. Refuses to start with unsafe configuration."""

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False
if SECRET_KEY.startswith("dev-") or len(SECRET_KEY) < 50:  # noqa: F405
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set to a strong value in production")
if OTP_DEV_ECHO:  # noqa: F405
    raise ImproperlyConfigured("OTP_DEV_ECHO must be false outside development")
if SMS_PROVIDER == "console" and ENVIRONMENT == "production":  # noqa: F405
    raise ImproperlyConfigured("SMS_PROVIDER=console is not allowed in production")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SECURE_REDIRECT_EXEMPT = [r"^health"]
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
REFRESH_COOKIE_SECURE = True
