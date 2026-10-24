"""Denormalized-counter maintenance for `Vendor.rating_avg`/`rating_count`/`follower_count`
(Phase 9, ARCHITECTURE D30). Centralised here so every write path (review create, moderation
hide/unhide, follow/unfollow) updates the same two counters the same way, instead of each view
reimplementing its own aggregate query."""

from __future__ import annotations

from django.db.models import Avg, Count, F

from vc.notifications import service as notifications
from vc.vendors.models import Vendor

from .models import Post, Review


def recompute_vendor_rating(vendor_id) -> None:
    agg = Review.objects.filter(vendor_id=vendor_id, status=Review.STATUS_PUBLISHED).aggregate(
        avg=Avg("rating"), count=Count("id")
    )
    Vendor.objects.filter(pk=vendor_id).update(rating_avg=agg["avg"] or 0, rating_count=agg["count"] or 0)


def adjust_follower_count(vendor_id, delta: int) -> None:
    Vendor.objects.filter(pk=vendor_id).update(follower_count=F("follower_count") + delta)


def notify_followers_of_new_post(post: Post) -> None:
    """Real, synchronous fan-out (no task queue exists in this project yet) — bounded in practice
    by how many followers a small local shop actually has. A deliberate, discrete vendor action
    (publishing) earns a notification; likes/comments would not (master prompt §28: "do not create
    noisy notifications for every minor interaction")."""

    follower_ids = list(post.vendor.followers.values_list("user_id", flat=True))
    if not follower_ids:
        return
    from vc.notifications.models import Notification

    Notification.objects.bulk_create(
        [
            Notification(
                user_id=uid,
                kind="new_post",
                title=f"{post.vendor.shop_name} posted something new",
                body=post.caption[:200],
                data={"post_id": str(post.id), "vendor_handle": post.vendor.handle},
            )
            for uid in follower_ids
        ]
    )


def notify_new_follower(vendor_owner, follower_name: str) -> None:
    notifications.notify(
        vendor_owner,
        kind="new_follower",
        title="You have a new follower",
        body=f"{follower_name or 'A customer'} started following your shop.",
    )
