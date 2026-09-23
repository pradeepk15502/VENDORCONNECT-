from django.urls import path

from . import views

urlpatterns = [
    path("otp/request", views.OtpRequestView.as_view(), name="otp-request"),
    path("otp/verify", views.OtpVerifyView.as_view(), name="otp-verify"),
    path("admin/password", views.AdminPasswordView.as_view(), name="admin-password"),
    path("token/refresh", views.RefreshView.as_view(), name="token-refresh"),
    path("logout", views.LogoutView.as_view(), name="logout"),
    path("me", views.MeView.as_view(), name="me"),
]
