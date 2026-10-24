from django.urls import path

from . import views

urlpatterns = [
    path("media", views.MediaUploadView.as_view(), name="media-upload"),
]
