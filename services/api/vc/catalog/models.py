from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.db import models

from vc.core.models import TimeStampedModel

UNIT_CHOICES = [
    ("kg", "kg"),
    ("g", "g"),
    ("l", "litre"),
    ("ml", "ml"),
    ("piece", "piece"),
    ("dozen", "dozen"),
    ("packet", "packet"),
    ("bundle", "bundle"),
    ("box", "box"),
    ("pair", "pair"),
    ("strip", "strip"),
    ("bottle", "bottle"),
    ("meter", "metre"),
]


class Category(TimeStampedModel):
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    slug = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=80)
    names_i18n = models.JSONField(default=dict, blank=True, help_text='{"hi": "सब्ज़ियाँ"}')
    icon = models.CharField(max_length=40, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # freshness thresholds (hours); null → global defaults
    freshness_aging_hours = models.PositiveSmallIntegerField(null=True, blank=True)
    freshness_stale_hours = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Product(TimeStampedModel):
    """Platform product concept, e.g. 'Tomato'. Shared by many vendors."""

    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    slug = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=120)
    names_i18n = models.JSONField(default=dict, blank=True)
    default_unit = models.CharField(max_length=10, choices=UNIT_CHOICES, default="piece")
    image = models.ForeignKey("assets.MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    barcode = models.CharField(max_length=32, blank=True, db_index=True)
    attributes = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [GinIndex(fields=["name"], opclasses=["gin_trgm_ops"], name="product_name_trgm")]

    def __str__(self):
        return self.name


class ProductVariety(TimeStampedModel):
    """Types that matter locally, e.g. Tomato → Hybrid / Desi."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="varieties")
    name = models.CharField(max_length=80)
    names_i18n = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "name"], name="uniq_product_variety")]


class ProductAlias(models.Model):
    """Search synonyms across languages/scripts: 'tamatar', 'टमाटर', 'tomatoes'."""

    KIND_SYNONYM, KIND_TRANSLITERATION, KIND_NATIVE, KIND_MISSPELLING = "synonym", "translit", "native", "misspelling"
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="aliases")
    text = models.CharField(max_length=120)
    normalized = models.CharField(max_length=120, db_index=True)
    lang = models.CharField(max_length=8, default="en")
    kind = models.CharField(max_length=12, default=KIND_SYNONYM)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "normalized"], name="uniq_alias")]
        indexes = [GinIndex(fields=["normalized"], opclasses=["gin_trgm_ops"], name="alias_trgm")]


class VendorProduct(TimeStampedModel):
    """A vendor's listing: its own price, unit, availability and freshness."""

    AVAIL_IN_STOCK, AVAIL_LOW, AVAIL_OUT = "in_stock", "low_stock", "out_of_stock"
    AVAILABILITY = [(AVAIL_IN_STOCK, "In stock"), (AVAIL_LOW, "Low stock"), (AVAIL_OUT, "Out of stock")]
    STATUS_ACTIVE, STATUS_PAUSED, STATUS_DELETED = "active", "paused", "deleted"
    SOURCE_MANUAL, SOURCE_AI = "manual", "ai"

    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.CASCADE, related_name="listings")
    product = models.ForeignKey(Product, null=True, blank=True, on_delete=models.PROTECT, related_name="listings")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="listings")
    variety = models.ForeignKey(ProductVariety, null=True, blank=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=120, help_text="Display name (defaults to product name)")
    description = models.CharField(max_length=1000, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES)
    unit_quantity = models.DecimalField(max_digits=8, decimal_places=2, default=1, help_text="price is per N units")
    availability = models.CharField(max_length=14, choices=AVAILABILITY, default=AVAIL_IN_STOCK)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="optional count")
    low_stock_threshold = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=10, default=STATUS_ACTIVE, db_index=True)
    stock_updated_at = models.DateTimeField()
    price_updated_at = models.DateTimeField()
    images = models.ManyToManyField("assets.MediaAsset", blank=True, related_name="+")
    source = models.CharField(max_length=10, default="manual", help_text="manual | ai")

    class Meta:
        indexes = [
            models.Index(fields=["vendor", "status", "availability"]),
            models.Index(fields=["product", "status", "availability"]),
            GinIndex(fields=["name"], opclasses=["gin_trgm_ops"], name="listing_name_trgm"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(price__gte=0), name="price_non_negative"),
            models.UniqueConstraint(
                fields=["vendor", "product", "variety", "unit"],
                condition=models.Q(status__in=["active", "paused"]) & models.Q(product__isnull=False),
                name="uniq_active_listing",
                nulls_distinct=False,
            ),
        ]


class PriceHistory(models.Model):
    """prices table: append-only price changes per listing."""

    listing = models.ForeignKey(VendorProduct, on_delete=models.CASCADE, related_name="price_history")
    price = models.DecimalField(max_digits=10, decimal_places=2)
    changed_at = models.DateTimeField(auto_now_add=True)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        indexes = [models.Index(fields=["listing", "-changed_at"])]


class InventoryEvent(models.Model):
    """inventory table: append-only availability/quantity changes (supports offline sync replay)."""

    listing = models.ForeignKey(VendorProduct, on_delete=models.CASCADE, related_name="inventory_events")
    availability = models.CharField(max_length=14)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    occurred_at = models.DateTimeField(help_text="client time of the change (offline queue)")
    recorded_at = models.DateTimeField(auto_now_add=True)
    client_mutation_id = models.CharField(max_length=64, blank=True, help_text="idempotency key from client")
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        indexes = [models.Index(fields=["listing", "-occurred_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["listing", "client_mutation_id"],
                condition=~models.Q(client_mutation_id=""),
                name="uniq_inventory_mutation",
            )
        ]


class MarketPrice(models.Model):
    """Reference market price range used for advisory suggestions only."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="market_prices")
    variety = models.ForeignKey(ProductVariety, null=True, blank=True, on_delete=models.CASCADE)
    region = models.CharField(max_length=80, help_text="city or district")
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES)
    min_price = models.DecimalField(max_digits=10, decimal_places=2)
    max_price = models.DecimalField(max_digits=10, decimal_places=2)
    source = models.CharField(max_length=120)
    observed_at = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=["product", "region", "-observed_at"])]
