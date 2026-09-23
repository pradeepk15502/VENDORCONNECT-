from django.urls import path

from . import health

urlpatterns = [
    path("health", health.health, name="health"),
    path("health/ready", health.ready, name="health-ready"),
]

from .admin_views import AdminWhoAmIView  # noqa: E402

urlpatterns += [path("api/v1/admin/whoami", AdminWhoAmIView.as_view(), name="admin-whoami")]
