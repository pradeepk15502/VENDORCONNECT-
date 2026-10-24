from django.urls import path

from . import views

urlpatterns = [
    path("vendors/<str:handle>/follow", views.FollowView.as_view(), name="vendor-follow"),
    path("vendors/<str:handle>/unfollow", views.UnfollowView.as_view(), name="vendor-unfollow"),
    path("following", views.FollowingListView.as_view(), name="following-list"),
    path("feed", views.FeedView.as_view(), name="feed"),
    path("vendors/me/posts", views.MyPostCollectionView.as_view(), name="post-collection"),
    path("vendors/<str:handle>/posts", views.VendorPostsPublicView.as_view(), name="vendor-posts-public"),
    path("posts/<uuid:post_id>", views.PostDetailView.as_view(), name="post-detail"),
    path("posts/<uuid:post_id>/report", views.ReportPostView.as_view(), name="post-report"),
    path("vendors/<str:handle>/reviews", views.VendorReviewsView.as_view(), name="vendor-reviews"),
    path("listings/<uuid:listing_id>/reviews", views.ListingReviewsView.as_view(), name="listing-reviews"),
    path("reviews/mine", views.MyReviewsView.as_view(), name="my-reviews"),
    path("reviews/<uuid:review_id>/reply", views.ReviewReplyView.as_view(), name="review-reply"),
    path("reviews/<uuid:review_id>/report", views.ReportReviewView.as_view(), name="review-report"),
]
