from decimal import Decimal

from django.conf import settings
from django.contrib.gis.db import models as gis
from django.contrib.postgres.indexes import GinIndex
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Upper

from vc.core.models import TimeStampedModel


class Vendor(TimeStampedModel):
    """A shop. `handle` is the public, stable Vendor ID (e.g. SHARMA001, displayed @SHARMA001)."""

    STATUS_ACTIVE, STATUS_SUSPENDED, STATUS_CLOSED_PERMANENTLY = "active", "suspended", "closed_permanently"
    VERIFY_UNVERIFIED, VERIFY_PENDING, VERIFY_VERIFIED, VERIFY_REJECTED = (
        "unverified",
        "pending",
        "verified",
        "rejected",
    )

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="vendors")
    handle = models.CharField(max_length=16, unique=True, editable=False)
    shop_name = models.CharField(max_length=120)
    status = models.CharField(
        max_length=20,
        default=STATUS_ACTIVE,
        choices=[(STATUS_ACTIVE, "Active"), (STATUS_SUSPENDED, "Suspended"), (STATUS_CLOSED_PERMANENTLY, "Closed")],
        db_index=True,
    )
    verification_status = models.CharField(
        max_length=12,
        default=VERIFY_UNVERIFIED,
        choices=[
            (VERIFY_UNVERIFIED, "Unverified"),
            (VERIFY_PENDING, "Pending review"),
            (VERIFY_VERIFIED, "Verified"),
            (VERIFY_REJECTED, "Rejected"),
        ],
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    is_open = models.BooleanField(default=False, help_text="Manual shop status; source of truth for customers")
    status_changed_at = models.DateTimeField(null=True, blank=True)
    public_phone = models.CharField(max_length=16, blank=True, help_text="Shown to customers for calls")
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="vendors")
    # denormalised for ranking / cards (updated by review service)
    rating_avg = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    rating_count = models.PositiveIntegerField(default=0)
    follower_count = models.PositiveIntegerField(default=0)
    onboarding_step = models.CharField(max_length=20, default="shop")

    class Meta:
        constraints = [models.UniqueConstraint(Upper("handle"), name="vendor_handle_ci_unique")]
        indexes = [
            GinIndex(fields=["shop_name"], opclasses=["gin_trgm_ops"], name="vendor_name_trgm"),
            models.Index(fields=["status", "is_open"]),
        ]
        permissions = [
            ("verify_vendor", "Can verify / reject vendors"),
            ("suspend_vendor", "Can suspend / reinstate vendors"),
        ]

    def __str__(self):
        return f"@{self.handle} {self.shop_name}"

    @property
    def display_handle(self) -> str:
        return f"@{self.handle}"

    @property
    def is_visible(self) -> bool:
        return self.status == self.STATUS_ACTIVE


class VendorProfile(models.Model):
    vendor = models.OneToOneField(Vendor, on_delete=models.CASCADE, primary_key=True, related_name="profile")
    bio = models.CharField(max_length=500, blank=True)
    profile_image = models.ForeignKey(
        "assets.MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    cover_image = models.ForeignKey(
        "assets.MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    gstin = models.CharField(max_length=15, blank=True)
    business_type = models.CharField(max_length=40, blank=True)
    languages = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class VendorLocation(models.Model):
    vendor = models.OneToOneField(Vendor, on_delete=models.CASCADE, primary_key=True, related_name="location")
    point = gis.PointField(geography=True, srid=4326, spatial_index=True)
    address_line = models.CharField(max_length=250)
    landmark = models.CharField(max_length=120, blank=True)
    locality = models.CharField(max_length=120, blank=True)
    city = models.CharField(max_length=80)
    state = models.CharField(max_length=80, blank=True)
    pincode = models.CharField(max_length=6, blank=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)


class VendorHours(models.Model):
    """Informational opening hours; `Vendor.is_open` is what customers see (ARCHITECTURE D9)."""

    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name="hours")
    weekday = models.PositiveSmallIntegerField(help_text="0=Monday … 6=Sunday")
    opens_at = models.TimeField()
    closes_at = models.TimeField()

    class Meta:
        ordering = ["weekday", "opens_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(weekday__gte=0, weekday__lte=6), name="weekday_range"),
        ]


class DeliverySettings(models.Model):
    """Delivery is optional. Default OFF → customers see 'Pickup only'."""

    vendor = models.OneToOneField(Vendor, on_delete=models.CASCADE, primary_key=True, related_name="delivery")
    delivery_enabled = models.BooleanField(default=False)
    pickup_enabled = models.BooleanField(default=True)
    radius_km = models.DecimalField(
        max_digits=4,
        decimal_places=1,
        default=3,
        validators=[MinValueValidator(Decimal("0.5")), MaxValueValidator(Decimal("50"))],
    )
    min_order_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(0)]
    )
    delivery_fee = models.DecimalField(max_digits=8, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    free_delivery_above = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vendors_vendor_delivery_settings"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(radius_km__gt=0, radius_km__lte=50), name="delivery_radius_range"
            ),
            models.CheckConstraint(
                condition=models.Q(delivery_enabled=True) | models.Q(pickup_enabled=True),
                name="at_least_one_fulfilment",
            ),
        ]


class VendorVerification(TimeStampedModel):
    """Verification request/decision trail."""

    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name="verifications")
    submitted_documents = models.JSONField(default=list, blank=True)
    decision = models.CharField(max_length=12, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=500, blank=True)
