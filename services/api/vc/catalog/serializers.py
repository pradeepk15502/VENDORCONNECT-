from django.conf import settings
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from vc.core.geo import INDIA_BOUNDS

from .models import Category, InventoryEvent, PriceHistory, Product, ProductVariety, VendorProduct
from .search import SearchResult


class CategorySerializer(serializers.ModelSerializer):
    parent = serializers.SlugRelatedField(slug_field="slug", read_only=True)

    class Meta:
        model = Category
        fields = ["slug", "name", "names_i18n", "icon", "parent", "sort_order"]


class SearchQuerySerializer(serializers.Serializer):
    """Query params for GET /search. `lat`/`lng` are the customer's current position, sent per
    request and never stored (ARCHITECTURE D11). The filter fields (Phase 6, D26) are all opt-in —
    omitted/false means "don't narrow," matching the search backend's default ranking."""

    q = serializers.CharField(required=False, allow_blank=True, max_length=120, default="")
    lat = serializers.FloatField(min_value=INDIA_BOUNDS["lat"][0], max_value=INDIA_BOUNDS["lat"][1])
    lng = serializers.FloatField(min_value=INDIA_BOUNDS["lng"][0], max_value=INDIA_BOUNDS["lng"][1])
    category = serializers.SlugField(required=False, allow_blank=True, default="")
    radius_km = serializers.FloatField(required=False, min_value=0.5, max_value=settings.SEARCH_RADIUS_KM_MAX)
    in_stock_only = serializers.BooleanField(required=False, default=False)
    open_now = serializers.BooleanField(required=False, default=False)
    delivery = serializers.BooleanField(required=False, default=False)
    pickup = serializers.BooleanField(required=False, default=False)
    price_min = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False)
    price_max = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False)

    def validate_category(self, value):
        if value and not Category.objects.filter(slug=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown category.")
        return value

    def validate(self, attrs):
        lo, hi = attrs.get("price_min"), attrs.get("price_max")
        if lo is not None and hi is not None and lo > hi:
            raise serializers.ValidationError({"price_max": "Must be greater than or equal to price_min."})
        return attrs


class _SearchVendorSerializer(serializers.Serializer):
    handle = serializers.CharField()
    vendor_id = serializers.CharField(source="display_handle")
    shop_name = serializers.CharField()
    is_open = serializers.BooleanField()
    verified = serializers.SerializerMethodField()
    delivery_enabled = serializers.SerializerMethodField()
    # Phase 6 (D26 map view): the vendor's real coordinates, so a result can be plotted on the map
    # without a second round trip. `vendor__location` is already select_related in search.py.
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()

    @extend_schema_field(serializers.BooleanField())
    def get_verified(self, vendor) -> bool:
        return vendor.verification_status == vendor.VERIFY_VERIFIED

    @extend_schema_field(serializers.BooleanField())
    def get_delivery_enabled(self, vendor) -> bool:
        delivery = getattr(vendor, "delivery", None)
        return bool(delivery and delivery.delivery_enabled)

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_lat(self, vendor) -> float | None:
        loc = getattr(vendor, "location", None)
        return round(loc.point.y, 6) if loc else None

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_lng(self, vendor) -> float | None:
        loc = getattr(vendor, "location", None)
        return round(loc.point.x, 6) if loc else None


class SearchResultSerializer(serializers.Serializer):
    """One vendor's listing, enriched with distance and freshness for ranking transparency."""

    id = serializers.UUIDField(source="listing.id")
    name = serializers.CharField(source="listing.name")
    price = serializers.DecimalField(source="listing.price", max_digits=10, decimal_places=2)
    mrp = serializers.DecimalField(source="listing.mrp", max_digits=10, decimal_places=2, allow_null=True)
    unit = serializers.CharField(source="listing.unit")
    unit_quantity = serializers.DecimalField(source="listing.unit_quantity", max_digits=8, decimal_places=2)
    availability = serializers.CharField(source="listing.availability")
    category = serializers.SerializerMethodField()
    product = serializers.SerializerMethodField()
    freshness = serializers.SerializerMethodField()
    stock_updated_at = serializers.DateTimeField(source="listing.stock_updated_at")
    distance_km = serializers.SerializerMethodField()
    vendor = serializers.SerializerMethodField()

    @extend_schema_field(
        {"type": "object", "nullable": True, "properties": {"slug": {"type": "string"}, "name": {"type": "string"}}}
    )
    def get_product(self, result: SearchResult):
        product = result.listing.product
        return {"slug": product.slug, "name": product.name} if product else None

    # Phase 12 hardening (docs/ARCHITECTURE.md D33): was a `SlugRelatedField` — functionally identical
    # (still just the category's slug string) but drf-spectacular warned on it, because a plain
    # `serializers.Serializer` has no `Meta.model` for it to derive the related field's type from, and
    # (unlike a `SerializerMethodField`) `@extend_schema_field` on a bare field instance doesn't survive
    # DRF re-instantiating the field from its constructor args on every serializer use (see
    # `rest_framework.fields.Field.__deepcopy__`) — a `SerializerMethodField` sidesteps that entirely.
    @extend_schema_field(serializers.CharField())
    def get_category(self, result: SearchResult) -> str:
        return result.listing.category.slug

    @extend_schema_field(serializers.ChoiceField(choices=["fresh", "aging", "stale"]))
    def get_freshness(self, result: SearchResult) -> str:
        from vc.vendors.freshness import freshness as compute_freshness

        return compute_freshness(result.listing.stock_updated_at, result.listing.category)

    @extend_schema_field(serializers.FloatField())
    def get_distance_km(self, result: SearchResult) -> float:
        return round(result.distance_km, 2)

    @extend_schema_field(_SearchVendorSerializer())
    def get_vendor(self, result: SearchResult):
        return _SearchVendorSerializer(result.listing.vendor).data


# --- Admin (Phase 11, ARCHITECTURE D32) ----------------------------------------------------------


class AdminCategorySerializer(serializers.ModelSerializer):
    """Includes inactive categories and real usage counts — the public `CategorySerializer` above
    deliberately omits both (it's a customer-facing browse list), but an admin auditing the taxonomy
    for "problematic taxonomy entries" (master prompt §10) needs exactly what's hidden from customers."""

    product_count = serializers.IntegerField(read_only=True)
    listing_count = serializers.IntegerField(read_only=True)
    vendor_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = [
            "slug",
            "name",
            "icon",
            "sort_order",
            "is_active",
            "product_count",
            "listing_count",
            "vendor_count",
        ]


class _AdminListingVendorRefSerializer(serializers.Serializer):
    handle = serializers.CharField()
    shop_name = serializers.CharField()


class AdminListingSerializer(serializers.ModelSerializer):
    """A vendor's listing (`VendorProduct`), for admin catalog visibility (master prompt §10) — read
    only. Admin staff can browse/filter to spot duplicates or suspicious entries themselves; nothing
    here lets an admin silently edit a vendor's own price/stock (master prompt: "do not silently
    alter vendor-owned pricing or inventory")."""

    vendor = _AdminListingVendorRefSerializer(read_only=True)
    category = serializers.SlugRelatedField(read_only=True, slug_field="slug")
    product_slug = serializers.CharField(source="product.slug", default=None, read_only=True)

    class Meta:
        model = VendorProduct
        fields = [
            "id",
            "vendor",
            "name",
            "product_slug",
            "category",
            "price",
            "unit",
            "availability",
            "status",
            "source",
            "created_at",
            "updated_at",
        ]


# --- Vendor-facing product/inventory/price management (Phase 4) -----------------------------
# Read/write are deliberately split: `price` and `availability`/`quantity` are each the head of
# their own append-only audit table (PriceHistory, InventoryEvent — see docs/DATABASE.md), so they
# are only ever changed through POST /prices and POST /inventory, never through the descriptive-field
# PATCH on /vendor-products/{id}. This keeps every price/stock change auditable at the point it's
# made, rather than reconstructable only by diffing snapshots. See ARCHITECTURE.md Phase 4 notes.


class VendorProductQuerySerializer(serializers.Serializer):
    """Query params for GET /vendor-products (the signed-in vendor's own listings)."""

    status = serializers.ChoiceField(
        choices=[VendorProduct.STATUS_ACTIVE, VendorProduct.STATUS_PAUSED, VendorProduct.STATUS_DELETED],
        required=False,
        allow_blank=True,
        default="",
    )
    category = serializers.SlugField(required=False, allow_blank=True, default="")
    availability = serializers.ChoiceField(
        choices=VendorProduct.AVAILABILITY, required=False, allow_blank=True, default=""
    )

    def validate_category(self, value):
        if value and not Category.objects.filter(slug=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown category.")
        return value


class VendorProductSerializer(serializers.ModelSerializer):
    """A vendor's own listing, full detail — the read shape for GET /vendor-products[/{id}] and the
    response after create/update/stock/price changes."""

    category = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    product = serializers.SerializerMethodField()
    variety = serializers.SerializerMethodField()
    freshness = serializers.SerializerMethodField()

    class Meta:
        model = VendorProduct
        fields = [
            "id",
            "product",
            "category",
            "variety",
            "name",
            "description",
            "price",
            "mrp",
            "unit",
            "unit_quantity",
            "availability",
            "quantity",
            "low_stock_threshold",
            "status",
            "stock_updated_at",
            "price_updated_at",
            "source",
            "freshness",
            "created_at",
            "updated_at",
        ]

    @extend_schema_field(
        {"type": "object", "nullable": True, "properties": {"slug": {"type": "string"}, "name": {"type": "string"}}}
    )
    def get_product(self, obj: VendorProduct):
        return {"slug": obj.product.slug, "name": obj.product.name} if obj.product else None

    @extend_schema_field(
        {"type": "object", "nullable": True, "properties": {"id": {"type": "string"}, "name": {"type": "string"}}}
    )
    def get_variety(self, obj: VendorProduct):
        return {"id": str(obj.variety_id), "name": obj.variety.name} if obj.variety else None

    @extend_schema_field(serializers.ChoiceField(choices=["fresh", "aging", "stale"]))
    def get_freshness(self, obj: VendorProduct) -> str:
        from vc.vendors.freshness import freshness as compute_freshness

        return compute_freshness(obj.stock_updated_at, obj.category)


class VendorProductPublicSerializer(serializers.ModelSerializer):
    """Customer-facing shape for GET /vendors/{handle}/products (Phase 8, ARCHITECTURE D29) — the
    vendor profile's "Products" tab. Mirrors what `SearchResultSerializer` already shows a customer
    per listing: no raw stock counts or vendor-internal fields (`quantity`, `low_stock_threshold`,
    `source`, `status`) — a customer only ever needs to know in/low/out of stock, never the exact
    count a vendor is managing their shelf with."""

    category = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    product = serializers.SerializerMethodField()
    freshness = serializers.SerializerMethodField()

    class Meta:
        model = VendorProduct
        fields = [
            "id",
            "product",
            "category",
            "name",
            "description",
            "price",
            "mrp",
            "unit",
            "unit_quantity",
            "availability",
            "freshness",
            "stock_updated_at",
        ]

    @extend_schema_field(
        {"type": "object", "nullable": True, "properties": {"slug": {"type": "string"}, "name": {"type": "string"}}}
    )
    def get_product(self, obj: VendorProduct):
        return {"slug": obj.product.slug, "name": obj.product.name} if obj.product else None

    @extend_schema_field(serializers.ChoiceField(choices=["fresh", "aging", "stale"]))
    def get_freshness(self, obj: VendorProduct) -> str:
        from vc.vendors.freshness import freshness as compute_freshness

        return compute_freshness(obj.stock_updated_at, obj.category)


class ListingVendorRefSerializer(serializers.Serializer):
    handle = serializers.CharField()
    vendor_id = serializers.CharField(source="display_handle")
    shop_name = serializers.CharField()
    is_open = serializers.BooleanField()


class ListingDetailSerializer(VendorProductPublicSerializer):
    """GET /listings/{id} (Phase 9) — the standalone product-detail page a Post/Review "View
    Product" link opens (master prompt §12/§15). Same customer-facing listing shape as the vendor
    profile's Products tab (`VendorProductPublicSerializer`), plus enough vendor context to render
    without a second round trip — this project has no separate "product page" outside a vendor's
    own shop (ARCHITECTURE.md: "find the product, find the local shop" stays one screen)."""

    vendor = ListingVendorRefSerializer(read_only=True)

    class Meta(VendorProductPublicSerializer.Meta):
        fields = VendorProductPublicSerializer.Meta.fields + ["vendor"]


def _validate_variety_matches_product(variety, product):
    if variety and (not product or variety.product_id != product.id):
        raise serializers.ValidationError({"variety": "Variety must belong to the selected product."})


def _validate_category_matches_product(category, product):
    if product and category and product.category_id != category.id:
        raise serializers.ValidationError({"category": "Category must match the selected product's category."})


class VendorProductCreateSerializer(serializers.ModelSerializer):
    """POST /vendor-products. `product`/`variety` are optional (ARCHITECTURE D8 — a vendor may list
    a custom item outside the shared catalog; `name` is always required so a listing is never
    unnamed). Sets the initial price/stock and files the first PriceHistory/InventoryEvent rows so
    every listing has a complete audit trail from creation, not just from its first edit."""

    category = serializers.SlugRelatedField(slug_field="slug", queryset=Category.objects.filter(is_active=True))
    product = serializers.SlugRelatedField(
        slug_field="slug", queryset=Product.objects.filter(is_active=True), required=False, allow_null=True
    )
    variety = serializers.PrimaryKeyRelatedField(queryset=ProductVariety.objects.all(), required=False, allow_null=True)
    availability = serializers.ChoiceField(
        choices=VendorProduct.AVAILABILITY, required=False, default=VendorProduct.AVAIL_IN_STOCK
    )
    # Explicit min_value: the model's own `price_non_negative` CHECK constraint would also catch a
    # negative price, but as a bare IntegrityError it's indistinguishable from the uniqueness
    # constraint the view already translates to 409 "duplicate_listing" — validating here keeps a
    # bad price a normal 400 instead of a misleading conflict.
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)

    class Meta:
        model = VendorProduct
        fields = [
            "category",
            "product",
            "variety",
            "name",
            "description",
            "price",
            "mrp",
            "unit",
            "unit_quantity",
            "quantity",
            "low_stock_threshold",
            "availability",
        ]

    def validate(self, attrs):
        _validate_variety_matches_product(attrs.get("variety"), attrs.get("product"))
        _validate_category_matches_product(attrs.get("category"), attrs.get("product"))
        mrp = attrs.get("mrp")
        if mrp is not None and attrs["price"] > mrp:
            raise serializers.ValidationError({"mrp": "MRP cannot be less than price."})
        return attrs

    def save(self, *, vendor):
        user = self.context["request"].user
        now = timezone.now()
        listing = VendorProduct.objects.create(
            vendor=vendor, stock_updated_at=now, price_updated_at=now, **self.validated_data
        )
        PriceHistory.objects.create(listing=listing, price=listing.price, changed_by=user)
        InventoryEvent.objects.create(
            listing=listing,
            availability=listing.availability,
            quantity=listing.quantity,
            occurred_at=now,
            changed_by=user,
        )
        return listing


class VendorProductUpdateSerializer(serializers.ModelSerializer):
    """PATCH /vendor-products/{id} — descriptive fields only. `price`, `availability` and `quantity`
    are rejected here (with a pointer to the right endpoint) since they belong to the append-only
    audit tables and must go through POST /prices / POST /inventory instead."""

    category = serializers.SlugRelatedField(
        slug_field="slug", queryset=Category.objects.filter(is_active=True), required=False
    )
    product = serializers.SlugRelatedField(
        slug_field="slug", queryset=Product.objects.filter(is_active=True), required=False, allow_null=True
    )
    variety = serializers.PrimaryKeyRelatedField(queryset=ProductVariety.objects.all(), required=False, allow_null=True)
    status = serializers.ChoiceField(choices=[VendorProduct.STATUS_ACTIVE, VendorProduct.STATUS_PAUSED], required=False)

    class Meta:
        model = VendorProduct
        fields = [
            "category",
            "product",
            "variety",
            "name",
            "description",
            "unit",
            "unit_quantity",
            "mrp",
            "low_stock_threshold",
            "status",
        ]

    def validate(self, attrs):
        blocked = {"price", "availability", "quantity"} & set(self.initial_data.keys())
        if blocked:
            raise serializers.ValidationError(
                {
                    field: f"Update this via POST /{'prices' if field == 'price' else 'inventory'}, not here."
                    for field in blocked
                }
            )
        product = attrs["product"] if "product" in attrs else self.instance.product
        variety = attrs["variety"] if "variety" in attrs else self.instance.variety
        category = attrs["category"] if "category" in attrs else self.instance.category
        _validate_variety_matches_product(variety, product)
        _validate_category_matches_product(category, product)
        mrp = attrs["mrp"] if "mrp" in attrs else self.instance.mrp
        if mrp is not None and self.instance.price > mrp:
            raise serializers.ValidationError({"mrp": "MRP cannot be less than the current price."})
        return attrs


class InventoryUpdateSerializer(serializers.Serializer):
    """POST /inventory — one-tap stock updates. `client_mutation_id` makes a retried/offline-queued
    submission idempotent (DATABASE.md `uniq_inventory_mutation`): replaying the same mutation id
    returns the already-applied state instead of double-recording it."""

    listing_id = serializers.UUIDField()
    availability = serializers.ChoiceField(choices=VendorProduct.AVAILABILITY)
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=0)
    client_mutation_id = serializers.CharField(required=False, allow_blank=True, max_length=64)


class PriceUpdateSerializer(serializers.Serializer):
    """POST /prices — changes a listing's price, filing a PriceHistory row."""

    listing_id = serializers.UUIDField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
