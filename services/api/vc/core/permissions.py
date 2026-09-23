from rest_framework.permissions import SAFE_METHODS, BasePermission


class HasRole(BasePermission):
    role: str = ""
    message = "You do not have access to this area."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.has_role(self.role))


class IsCustomer(HasRole):
    role = "customer"


class IsVendor(HasRole):
    role = "vendor"
    message = "Only vendors can do this."


def _admin_session(request) -> bool:
    """Token must come from the admin login (password + OTP), not a plain OTP login."""
    auth = request.auth
    try:
        return bool(auth is not None and auth.get("adm", False))
    except AttributeError:
        return False


class IsAdmin(HasRole):
    role = "admin"

    def has_permission(self, request, view):
        return super().has_permission(request, view) and _admin_session(request)


class IsStaffRole(BasePermission):
    """Admin, moderator or support, in an admin session."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and any(user.has_role(r) for r in ("admin", "moderator", "support"))
            and _admin_session(request)
        )


def admin_permission(perm: str):
    """Fine-grained admin permission, e.g. admin_permission("vendors.verify_vendor")."""

    class _Perm(BasePermission):
        message = "You do not have permission for this admin action."

        def has_permission(self, request, view):
            user = request.user
            return bool(
                user
                and user.is_authenticated
                and _admin_session(request)
                and (user.is_superuser or user.has_perm(perm))
            )

    _Perm.__name__ = f"AdminPerm_{perm.replace('.', '_')}"
    return _Perm


class ReadOnly(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS
