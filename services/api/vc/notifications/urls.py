from django.urls import path

from . import views

urlpatterns = [
    path("notifications", views.NotificationCollectionView.as_view(), name="notification-collection"),
    path("notifications/read-all", views.NotificationReadAllView.as_view(), name="notification-read-all"),
    path("notifications/<uuid:notification_id>/read", views.NotificationReadView.as_view(), name="notification-read"),
]
