"""Production / staging settings. Refuses to start with unsafe configuration."""

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False
if SECRET_KEY.startswith("dev-") or len(SECRET_KEY) < 50:  # noqa: F405
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set to a strong value in production")
if OTP_DEV_ECHO:  # noqa: F405
    raise ImproperlyConfigured("OTP_DEV_ECHO must be false outside development")
if SMS_PROVIDER == "console":  # noqa: F405
    # Phase 12 hardening: this used to also require `ENVIRONMENT == "production"`, but that made the
    # refusal bypassable by simply not setting (or misconfiguring) the separate ENVIRONMENT env var
    # while still deploying with DJANGO_SETTINGS_MODULE=config.settings.prod — the two other guards
    # in this file (SECRET_KEY, OTP_DEV_ECHO) never had that extra condition, and neither should
    # this one: loading `prod` settings at all is already the signal that this is production/staging.
    raise ImproperlyConfigured("SMS_PROVIDER=console is not allowed outside development")
if MEDIA_STORAGE_BACKEND == "s3" and not AWS_STORAGE_BUCKET_NAME:  # noqa: F405
    # Phase 13: catches the same class of mistake as the SMS/secret-key checks above — a deploy that
    # asked for the S3 backend but forgot the bucket name would otherwise fail at the first upload,
    # not at boot, and fail with a confusing boto3 error far from the actual misconfiguration.
    raise ImproperlyConfigured("AWS_STORAGE_BUCKET_NAME is required when MEDIA_STORAGE_BACKEND=s3")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SECURE_REDIRECT_EXEMPT = [r"^health"]
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
REFRESH_COOKIE_SECURE = True
