from django.urls import path

from . import views

urlpatterns = [
    path("admin/audit-logs", views.AdminAuditLogListView.as_view(), name="admin-audit-logs"),
]
