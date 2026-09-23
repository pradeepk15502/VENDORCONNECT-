from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken

STAFF_ROLES = ("admin", "moderator", "support")


def issue_tokens(user, *, admin_session: bool = False) -> tuple[str, str]:
    """`adm` claim marks a session that passed password + OTP. Admin APIs require it."""
    refresh = RefreshToken.for_user(user)
    roles = sorted(user.role_codes())
    adm = admin_session and any(r in roles for r in STAFF_ROLES)
    refresh["roles"] = roles
    refresh["adm"] = adm
    access = refresh.access_token
    access["roles"] = roles
    access["adm"] = adm
    return str(access), str(refresh)


def set_refresh_cookie(response, refresh: str):
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        refresh,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=settings.REFRESH_COOKIE_PATH,
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )


def clear_refresh_cookie(response):
    response.delete_cookie(
        settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH, samesite=settings.REFRESH_COOKIE_SAMESITE
    )
