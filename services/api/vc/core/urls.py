from django.urls import path

from . import health

urlpatterns = [
    path("health", health.health, name="health"),
    path("health/ready", health.ready, name="health-ready"),
]

from .admin_views import AdminDashboardView, AdminWhoAmIView  # noqa: E402

urlpatterns += [
    path("api/v1/admin/whoami", AdminWhoAmIView.as_view(), name="admin-whoami"),
    path("api/v1/admin/dashboard", AdminDashboardView.as_view(), name="admin-dashboard"),
]
