from django.urls import path

from . import views

urlpatterns = [
    # Mounted at api/v1/ (not api/v1/auth/) so that /addresses sits alongside the other domain
    # endpoints (/vendors, /chats, ...) — auth's own routes keep their existing "auth/" prefix here
    # instead, so their resulting URLs (api/v1/auth/otp/request, etc.) are unchanged.
    path("auth/otp/request", views.OtpRequestView.as_view(), name="otp-request"),
    path("auth/otp/verify", views.OtpVerifyView.as_view(), name="otp-verify"),
    path("auth/admin/password", views.AdminPasswordView.as_view(), name="admin-password"),
    path("auth/token/refresh", views.RefreshView.as_view(), name="token-refresh"),
    path("auth/logout", views.LogoutView.as_view(), name="logout"),
    path("auth/me", views.MeView.as_view(), name="me"),
    path("addresses", views.AddressCollectionView.as_view(), name="address-collection"),
    path("addresses/<uuid:address_id>", views.AddressDetailView.as_view(), name="address-detail"),
    # Admin (Phase 11, ARCHITECTURE D32)
    path("admin/users", views.AdminUserListView.as_view(), name="admin-user-list"),
    path("admin/users/<uuid:user_id>", views.AdminUserDetailView.as_view(), name="admin-user-detail"),
    path("admin/users/<uuid:user_id>/suspend", views.AdminUserSuspendView.as_view(), name="admin-user-suspend"),
    path("admin/users/<uuid:user_id>/restore", views.AdminUserRestoreView.as_view(), name="admin-user-restore"),
]
