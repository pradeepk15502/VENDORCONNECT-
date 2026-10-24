from django.urls import path

from . import views

urlpatterns = [
    path("ai/detections", views.AIDetectionCreateView.as_view(), name="ai-detections"),
    path("ai/detections/<uuid:pk>", views.AIDetectionDetailView.as_view(), name="ai-detection-detail"),
    path("ai/detections/<uuid:pk>/confirm", views.AIDetectionConfirmView.as_view(), name="ai-detection-confirm"),
    path("vendors/me/ai-detections", views.AIDetectionHistoryView.as_view(), name="ai-detection-history"),
    path("admin/ai/detections", views.AdminAIDetectionListView.as_view(), name="admin-ai-detections"),
]
