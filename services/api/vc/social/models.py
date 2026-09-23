from django.conf import settings
from django.db import models

from vc.core.models import TimeStampedModel


class Post(TimeStampedModel):
    KIND_CHOICES = [
        ("photo", "Photo"),
        ("video", "Video"),
        ("new_stock", "New stock"),
        ("offer", "Offer"),
        ("update", "Shop update"),
    ]
    STATUS_PUBLISHED, STATUS_HIDDEN, STATUS_REMOVED = "published", "hidden", "removed"

    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="posts")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default="photo")
    caption = models.CharField(max_length=1000, blank=True)
    linked_listings = models.ManyToManyField("catalog.VendorProduct", blank=True, related_name="posts")
    comments_enabled = models.BooleanField(default=False)
    status = models.CharField(max_length=10, default=STATUS_PUBLISHED, db_index=True)
    like_count = models.PositiveIntegerField(default=0)
    offer_valid_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["vendor", "status", "-created_at"])]


class PostMedia(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="media")
    asset = models.ForeignKey("assets.MediaAsset", on_delete=models.PROTECT, related_name="+")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position"]


class PostLike(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["post", "user"], name="uniq_post_like")]


class PostComment(TimeStampedModel):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    text = models.CharField(max_length=500)
    status = models.CharField(max_length=10, default="published")


class Follow(models.Model):
    """followers table: customer follows vendor (gets their posts)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="following")
    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="followers")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "vendor"], name="uniq_follow")]


class Favorite(models.Model):
    """favorites table: saved listing (e.g. for back-in-stock alerts)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    listing = models.ForeignKey("catalog.VendorProduct", on_delete=models.CASCADE, related_name="favorited_by")
    notify_back_in_stock = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "listing"], name="uniq_favorite")]


class Review(TimeStampedModel):
    STATUS_PUBLISHED, STATUS_HIDDEN, STATUS_FLAGGED = "published", "hidden", "flagged"

    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="reviews")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reviews")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="reviews")
    listing = models.ForeignKey("catalog.VendorProduct", null=True, blank=True, on_delete=models.SET_NULL)
    rating = models.PositiveSmallIntegerField()
    text = models.CharField(max_length=1000, blank=True)
    vendor_reply = models.CharField(max_length=1000, blank=True)
    vendor_replied_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, default=STATUS_PUBLISHED, db_index=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(rating__gte=1, rating__lte=5), name="rating_1_5"),
            models.UniqueConstraint(
                fields=["vendor", "author"],
                condition=models.Q(order__isnull=True),
                name="one_general_review_per_vendor",
            ),
        ]
        indexes = [models.Index(fields=["vendor", "status", "-created_at"])]


class ReviewMedia(models.Model):
    review = models.ForeignKey(Review, on_delete=models.CASCADE, related_name="media")
    asset = models.ForeignKey("assets.MediaAsset", on_delete=models.PROTECT, related_name="+")
