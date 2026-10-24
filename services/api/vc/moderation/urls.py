from django.urls import path

from . import views

urlpatterns = [
    path("moderation/reports", views.ReportListView.as_view(), name="moderation-reports"),
    path(
        "moderation/reports/<uuid:report_id>/resolve",
        views.ReportResolveView.as_view(),
        name="moderation-report-resolve",
    ),
    path("moderation/posts", views.PostModerationListView.as_view(), name="moderation-posts"),
    path("moderation/posts/<uuid:post_id>/hide", views.PostHideView.as_view(), name="moderation-post-hide"),
    path("moderation/posts/<uuid:post_id>/unhide", views.PostUnhideView.as_view(), name="moderation-post-unhide"),
    path("moderation/reviews", views.ReviewModerationListView.as_view(), name="moderation-reviews"),
    path("moderation/reviews/<uuid:review_id>/hide", views.ReviewHideView.as_view(), name="moderation-review-hide"),
    path(
        "moderation/reviews/<uuid:review_id>/unhide", views.ReviewUnhideView.as_view(), name="moderation-review-unhide"
    ),
]
