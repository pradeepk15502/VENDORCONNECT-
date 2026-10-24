"""Base settings shared by every environment. Values come from environment variables."""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
# parse_comments=True: several .env.example entries document their allowed values with a trailing
# `# comment` (SMS_PROVIDER, LOG_FORMAT, ...). django-environ defaults this to False, so a .env
# copied straight from .env.example silently corrupts those values with the comment text still
# attached — e.g. SMS_PROVIDER becomes "console       # console | msg91 | twilio (...)", which
# breaks the exact-match provider lookup in vc/accounts/sms.py, and LOG_FORMAT becomes an invalid
# logging formatter name that crashes `django.setup()` outright. Explicit dev.py/prod.py overrides
# were unaffected (Python defaults, not read from the file), which is why this didn't surface until
# a real .env was read.
environ.Env.read_env(BASE_DIR / ".env", overwrite=False, parse_comments=True)

ENVIRONMENT = env("ENVIRONMENT", default="development")
SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-change-me-0123456789-abcdefghijklmnopqrstuvwxyz")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "django.contrib.postgres",
    # third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # VendorConnect domains
    "vc.core",
    "vc.accounts",
    "vc.vendors",
    "vc.catalog",
    "vc.assets",
    "vc.social",
    "vc.chat",
    "vc.orders",
    "vc.notifications",
    "vc.ai",
    "vc.analytics",
    "vc.audit",
    "vc.moderation",
]

MIDDLEWARE = [
    "vc.core.middleware.RequestIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "vc.core.middleware.AccessLogMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

DATABASES = {"default": env.db("DATABASE_URL", default="postgis://vc:vc_dev_pw@localhost:5432/vendorconnect")}
DATABASES["default"]["ENGINE"] = "django.contrib.gis.db.backends.postgis"
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        "KEY_PREFIX": "vc",
    }
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "en"
LANGUAGES = [("en", "English"), ("hi", "हिन्दी")]
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Media uploads (Phase 9, ARCHITECTURE D12) -----------------------------
# `MediaStorage` (vc/assets/storage.py) is the only thing that reads these.
MEDIA_ROOT = env("MEDIA_ROOT", default=str(BASE_DIR / "media"))
MEDIA_URL = env("MEDIA_URL", default="/media/")
MEDIA_MAX_IMAGE_MB = env.int("MEDIA_MAX_IMAGE_MB", default=8)
MEDIA_MAX_VIDEO_MB = env.int("MEDIA_MAX_VIDEO_MB", default=50)
MEDIA_MAX_PER_POST = env.int("MEDIA_MAX_PER_POST", default=6)

# --- S3 media backend (Phase 13, ARCHITECTURE D34) --------------------------
# "local" (default, dev/CI — no AWS credentials needed) or "s3" (staging/production). The S3 client
# authenticates via boto3's default credential chain — the ECS task role in AWS, never a static key
# pair in settings (see infrastructure/aws/modules/iam) — so no AWS_ACCESS_KEY_ID/SECRET setting
# exists here at all.
MEDIA_STORAGE_BACKEND = env("MEDIA_STORAGE_BACKEND", default="local")
AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME", default="")
AWS_S3_REGION_NAME = env("AWS_S3_REGION_NAME", default="ap-south-1")
# Optional: point vc/assets/storage.py's S3MediaStorage at an S3-compatible endpoint other than real
# AWS (Supabase Storage, Cloudflare R2, ...). Empty/unset keeps real AWS S3 behaviour unchanged.
AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL", default="")
MEDIA_S3_SIGNED_URL_EXPIRY_SECONDS = env.int("MEDIA_S3_SIGNED_URL_EXPIRY_SECONDS", default=3600)

# --- REST framework -------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "vc.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "vc.core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", default="120/min"),
        "user": env("THROTTLE_USER", default="600/min"),
        "otp_request_ip": env("THROTTLE_OTP_IP", default="20/hour"),
        "otp_verify_ip": env("THROTTLE_OTP_VERIFY_IP", default="60/hour"),
        "admin_login": env("THROTTLE_ADMIN_LOGIN", default="10/hour"),
        # Phase 12 hardening (docs/ARCHITECTURE.md D33) — the generic "user" rate above is sized for
        # cheap CRUD; these four scopes cover endpoints with real per-call cost (CPU-bound OCR/barcode
        # inference, image decode+re-encode) or interpersonal-abuse potential (message/report
        # flooding between two already-authenticated accounts, which ownership checks alone don't
        # limit) that the flat budget wasn't sized for.
        "ai_detection": env("THROTTLE_AI_DETECTION", default="30/hour"),
        "media_upload": env("THROTTLE_MEDIA_UPLOAD", default="60/hour"),
        # 60/min (not 30/min): the existing pagination test legitimately sends 35 messages in a
        # single burst to populate more than one page (PAGE_SIZE=30) — a real fast-moving negotiation
        # or a multi-item product-share burst can plausibly do the same. 60/min (one message/second
        # sustained) still catches actual flooding without throttling ordinary rapid back-and-forth.
        "chat_message": env("THROTTLE_CHAT_MESSAGE", default="60/min"),
        "report_submit": env("THROTTLE_REPORT_SUBMIT", default="20/hour"),
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "VendorConnect API",
    "DESCRIPTION": "Local product discovery: find what you need at nearby shops.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    # Phase 9 added a second unrelated "kind" choice field (Post.kind) alongside chat's existing
    # Message.kind, and both are reused across more than one serializer — which is exactly the
    # condition under which drf-spectacular tries to give each a shared, field-name-based component
    # name ("KindEnum") rather than one scoped to its serializer. Two different value sets both
    # wanting that same generic name is an unresolvable collision (schema generation would otherwise
    # pick an opaque content-hash suffix, e.g. "Kind68cEnum") — named explicitly here instead so the
    # generated client/docs show a stable, readable name for each.
    "ENUM_NAME_OVERRIDES": {
        "ChatMessageKindEnum": ["text", "product"],
        "PostKindEnum": "vc.social.models.Post.KIND_CHOICES",
        # Phase 11 added a third/fourth serializer reusing two already-shared choice sets
        # (Order.status via AdminOrderListSerializer; Vendor.status via
        # AdminVendorListSerializer/AdminVendorDetailSerializer; Order.fulfilment via
        # AdminOrderListSerializer) — one reuse too many for drf-spectacular's own disambiguation,
        # which falls back to an opaque content-hash suffix (e.g. "Status857Enum"). Named explicitly
        # here for the same reason as the two overrides above.
        "AdminOrderStatusEnum": "vc.orders.models.Order.STATUS_CHOICES",
        # These two are Django model choices with real (value, label) pairs, not bare value lists —
        # the override hash is computed over the full pairs, so it must be given here verbatim rather
        # than as a plain list of values (which only matches a serializer ChoiceField(choices=[...])
        # declared without labels, like the two entries above).
        "AdminOrderFulfilmentEnum": [("pickup", "Pickup"), ("delivery", "Delivery")],
        "AdminVendorStatusEnum": [("active", "Active"), ("suspended", "Suspended"), ("closed_permanently", "Closed")],
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=30)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "sub",
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Refresh-token cookie (web clients). See ARCHITECTURE.md D5.
REFRESH_COOKIE_NAME = "vc_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth/"
REFRESH_COOKIE_SECURE = env.bool("REFRESH_COOKIE_SECURE", default=True)
REFRESH_COOKIE_SAMESITE = env("REFRESH_COOKIE_SAMESITE", default="Strict")

# --- OTP -----------------------------------------------------------------
OTP_LENGTH = 6
OTP_TTL_SECONDS = env.int("OTP_TTL_SECONDS", default=300)
OTP_MAX_ATTEMPTS = env.int("OTP_MAX_ATTEMPTS", default=5)
OTP_RESEND_COOLDOWN_SECONDS = env.int("OTP_RESEND_COOLDOWN_SECONDS", default=30)
OTP_MAX_PER_PHONE_PER_HOUR = env.int("OTP_MAX_PER_PHONE_PER_HOUR", default=5)
OTP_HMAC_KEY = env("OTP_HMAC_KEY", default=SECRET_KEY)
OTP_DEV_ECHO = env.bool("OTP_DEV_ECHO", default=False)  # never true outside dev/test
SMS_PROVIDER = env("SMS_PROVIDER", default="console")
DEFAULT_COUNTRY_CODE = "+91"

# --- CORS / CSRF --------------------------------------------------------
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
# Phase 12 hardening: without this, browser JS on the (cross-origin) SPAs can never read the
# X-Request-ID response header `RequestIdMiddleware` sets — CORS hides all non-"simple" response
# headers from `fetch`/`axios` unless the server explicitly allows them. The header only carries a
# request-correlation id (see docs/ARCHITECTURE.md), so exposing it is safe.
CORS_EXPOSE_HEADERS = ["X-Request-ID"]

# --- Security headers ----------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True

# --- Domain configuration -----------------------------------------------
# Hours after which a listing's stock info is "aging" / "stale" (per-category override in DB).
FRESHNESS_AGING_HOURS = env.int("FRESHNESS_AGING_HOURS", default=12)
FRESHNESS_STALE_HOURS = env.int("FRESHNESS_STALE_HOURS", default=48)
VENDOR_HANDLE_MAX_LETTERS = 8
# /search geo-filter radius (ARCHITECTURE D10). Default is a walkable/short-ride hyperlocal range;
# max is a hard ceiling clients can't override past (query param validation, see catalog/views.py).
SEARCH_RADIUS_KM_DEFAULT = env.float("SEARCH_RADIUS_KM_DEFAULT", default=5.0)
SEARCH_RADIUS_KM_MAX = env.float("SEARCH_RADIUS_KM_MAX", default=25.0)

# --- Logging --------------------------------------------------------------
# `import structlog` must happen before LOGGING is built: the formatters below hand
# `logging.config.dictConfig` real structlog objects (the ProcessorFormatter class and renderer
# instances), not dotted string paths. dictConfig only import-resolves its special "()" key — any
# other key (like "processor") is used as given, so a string there is never turned into the
# callable it names. structlog.stdlib.ProcessorFormatter.format() then tries to call that string as
# a processor and raises `TypeError: 'str' object is not callable`. Since this is a plain Python
# module rather than a JSON/YAML config file, there's no need for string paths at all — passing the
# live objects sidesteps the resolution gap entirely.
import structlog  # noqa: E402

LOG_LEVEL = env("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processor": structlog.processors.JSONRenderer(),
            "foreign_pre_chain": [
                structlog.contextvars.merge_contextvars,
                structlog.stdlib.add_log_level,
                structlog.stdlib.add_logger_name,
                structlog.processors.TimeStamper(fmt="iso"),
            ],
        },
        "console": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processor": structlog.dev.ConsoleRenderer(),
            "foreign_pre_chain": [
                structlog.contextvars.merge_contextvars,
                structlog.stdlib.add_log_level,
                structlog.stdlib.add_logger_name,
                structlog.processors.TimeStamper(fmt="iso"),
            ],
        },
    },
    "handlers": {
        "default": {
            "class": "logging.StreamHandler",
            "formatter": env("LOG_FORMAT", default="json"),
        }
    },
    "root": {"handlers": ["default"], "level": LOG_LEVEL},
    "loggers": {
        # Phase 12 hardening: Django's own `configure_logging()` always applies its
        # `DEFAULT_LOGGING` first (a StreamHandler active when DEBUG=True, an AdminEmailHandler
        # active when DEBUG=False), then layers this dict on top with `disable_existing_loggers`
        # left False. Without an explicit entry here, the "django" logger keeps those default
        # handlers *and* still propagates up to `root`'s "default" handler — so anything logged
        # through `django.request`/`django.security` (unhandled exceptions, 404s, CSRF failures)
        # was emitted twice: once as Django's raw unformatted text and once as the real structured
        # line. `propagate: False` here stops the double emission; `django.server`/`django.db.backends`
        # below are unaffected (they already override handlers/propagate for their own reasons).
        "django": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "django.server": {"level": "WARNING"},
        "django.db.backends": {"level": "WARNING"},
    },
}

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)
