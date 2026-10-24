from .base import *  # noqa: F401,F403
from .base import env

DEBUG = env.bool("DJANGO_DEBUG", default=True)
OTP_DEV_ECHO = env.bool("OTP_DEV_ECHO", default=True)
REFRESH_COOKIE_SECURE = env.bool("REFRESH_COOKIE_SECURE", default=False)
REFRESH_COOKIE_SAMESITE = env("REFRESH_COOKIE_SAMESITE", default="Lax")
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:5173", "http://localhost:5175"],  # web app, admin app
)
LOGGING["handlers"]["default"]["formatter"] = env("LOG_FORMAT", default="console")  # noqa: F405
