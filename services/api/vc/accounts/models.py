import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.contrib.gis.db import models as gis
from django.db import models
from django.db.models.functions import Now
from django.utils import timezone

from vc.core.models import TimeStampedModel


class Role(models.Model):
    CUSTOMER, VENDOR, ADMIN, MODERATOR, SUPPORT = "customer", "vendor", "admin", "moderator", "support"
    CHOICES = [
        (CUSTOMER, "Customer"),
        (VENDOR, "Vendor"),
        (ADMIN, "Admin"),
        (MODERATOR, "Moderator"),
        (SUPPORT, "Support"),
    ]

    code = models.CharField(max_length=20, primary_key=True, choices=CHOICES)
    description = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return self.code


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, phone, password=None, roles=("customer",), **extra):
        if not phone:
            raise ValueError("phone is required")
        user = self.model(phone=phone, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        for code in roles:
            user.add_role(code)
        return user

    def create_superuser(self, phone, password, **extra):
        extra.update(is_staff=True, is_superuser=True)
        return self.create_user(phone, password, roles=("customer", "admin"), **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """A person. One account can be customer and vendor at the same time."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=16, unique=True, help_text="E.164, e.g. +919876543210")
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    name = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    language = models.CharField(max_length=8, default="en")
    avatar = models.ForeignKey("assets.MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text="Can log into Django admin")
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspension_reason = models.CharField(max_length=300, blank=True)
    roles = models.ManyToManyField(Role, through="UserRole", through_fields=("user", "role"), related_name="users")
    date_joined = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS: list[str] = []
    objects = UserManager()

    class Meta:
        indexes = [models.Index(fields=["date_joined"])]
        permissions = [("manage_users", "Can suspend/restore user accounts (admin)")]

    def __str__(self):
        return self.name or self.masked_phone

    @property
    def masked_phone(self) -> str:
        return f"{self.phone[:3]}******{self.phone[-4:]}" if len(self.phone) > 7 else "****"

    def role_codes(self) -> set[str]:
        cache = getattr(self, "_role_cache", None)
        if cache is None:
            # Phase 12 hardening: `.values_list()` always issues its own query, even when
            # `user_roles` was `prefetch_related`'d — it clones the manager's queryset, which drops
            # the prefetch cache. When a prefetch is present, read the already-fetched objects
            # instead so a batch caller (e.g. the admin user list) doesn't pay a query per user.
            if "user_roles" in getattr(self, "_prefetched_objects_cache", {}):
                cache = {ur.role_id for ur in self.user_roles.all()}
            else:
                cache = set(self.user_roles.values_list("role_id", flat=True))
            self._role_cache = cache
        return cache

    def has_role(self, code: str) -> bool:
        return code in self.role_codes()

    def add_role(self, code: str):
        UserRole.objects.get_or_create(user=self, role_id=code)
        self._role_cache = None


class UserRole(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.PROTECT)
    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "role"], name="uniq_user_role")]


class OtpChallenge(TimeStampedModel):
    """One OTP send. Code stored only as HMAC; see accounts/otp.py."""

    PURPOSE_LOGIN = "login"
    phone = models.CharField(max_length=16, db_index=True)
    purpose = models.CharField(max_length=20, default=PURPOSE_LOGIN)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        indexes = [models.Index(fields=["phone", "-created_at"])]
        constraints = [models.CheckConstraint(condition=models.Q(attempts__lte=20), name="otp_attempts_sane")]


class Address(TimeStampedModel):
    """Saved customer address. Only shared with a vendor when a delivery order is placed."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=40, default="Home")
    line1 = models.CharField(max_length=200)
    line2 = models.CharField(max_length=200, blank=True)
    landmark = models.CharField(max_length=120, blank=True)
    city = models.CharField(max_length=80)
    state = models.CharField(max_length=80, blank=True)
    pincode = models.CharField(max_length=6)
    location = gis.PointField(geography=True, srid=4326, null=True, blank=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user"], condition=models.Q(is_default=True), name="one_default_address")
        ]


class PrivacySettings(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True, related_name="privacy")
    share_name_with_vendors = models.BooleanField(default=True)
    allow_analytics = models.BooleanField(default=True)
    show_reviews_publicly = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True, db_default=Now())
