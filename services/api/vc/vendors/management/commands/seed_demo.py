"""Dev-only demo data: a couple of shops with real listings near Gurugram, so `/search` and the
Search screen have something to find (there is no vendor-facing "add product" UI yet — that's
Phase 4 — so listings can only be seeded, not created through the app). Idempotent: safe to run
more than once. Never runs against a production settings module.
"""

from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from vc.accounts.models import User
from vc.catalog.models import Category, Product, VendorProduct
from vc.core.geo import make_point
from vc.vendors.handles import create_vendor_with_handle
from vc.vendors.models import DeliverySettings, Vendor, VendorLocation, VendorProfile

# Gurugram centre used throughout this repo's fixtures (conftest.SHOP, tests/e2e geolocation,
# apps/web CITIES) — placed a short distance apart so search-radius/ranking is meaningful to test.
DEMO_SHOPS = [
    {
        "phone": "+919990000001",
        "owner_name": "Ramesh Sharma",
        "shop_name": "Sharma Vegetable Store",
        "shop_category": "vegetables",
        "lat": 28.4598,
        "lng": 77.0270,
        "address_line": "Shop 12, Sector 14 Market",
        "city": "Gurugram",
        "pincode": "122001",
        "is_open": True,
        "listings": [
            ("tomato", "40", "kg", VendorProduct.AVAIL_IN_STOCK),
            ("onion", "35", "kg", VendorProduct.AVAIL_IN_STOCK),
            ("potato", "30", "kg", VendorProduct.AVAIL_LOW),
        ],
    },
    {
        "phone": "+919990000002",
        "owner_name": "Suresh Kumar",
        "shop_name": "Suresh Kirana Store",
        "shop_category": "grocery",
        "lat": 28.4700,
        "lng": 77.0450,  # ~2 km away — ranked below the closer shop for the same product
        "address_line": "Shop 3, Sector 15 Market",
        "city": "Gurugram",
        "pincode": "122001",
        "is_open": False,  # closed — still findable, just ranked lower (ARCHITECTURE D9/D10)
        "listings": [
            ("tomato", "38", "kg", VendorProduct.AVAIL_OUT),
            ("rice", "60", "kg", VendorProduct.AVAIL_IN_STOCK),
        ],
    },
]


class Command(BaseCommand):
    help = "Seed a couple of demo vendors with real listings near Gurugram, for /search (dev/test only)."

    @transaction.atomic
    def handle(self, *args, **opts):
        if settings.ENVIRONMENT == "production":
            raise CommandError("seed_demo refuses to run with ENVIRONMENT=production.")

        now = timezone.now()
        n_vendors = n_listings = 0
        for shop in DEMO_SHOPS:
            user, _ = User.objects.get_or_create(phone=shop["phone"], defaults={"name": shop["owner_name"]})
            vendor = Vendor.objects.filter(owner=user).exclude(status=Vendor.STATUS_CLOSED_PERMANENTLY).first()
            if vendor is None:
                vendor = create_vendor_with_handle(
                    owner=user, shop_name=shop["shop_name"], public_phone=shop["phone"], onboarding_step="done"
                )
                vendor.categories.set(Category.objects.filter(slug=shop["shop_category"]))
                VendorProfile.objects.create(vendor=vendor, bio="")
                VendorLocation.objects.create(
                    vendor=vendor,
                    point=make_point(shop["lat"], shop["lng"]),
                    address_line=shop["address_line"],
                    city=shop["city"],
                    pincode=shop["pincode"],
                )
                DeliverySettings.objects.create(vendor=vendor)
                user.add_role("vendor")
                n_vendors += 1

            changed = []
            if vendor.is_open != shop["is_open"]:
                vendor.is_open, vendor.status_changed_at = shop["is_open"], now
                changed += ["is_open", "status_changed_at"]
            if vendor.verification_status != Vendor.VERIFY_VERIFIED:
                vendor.verification_status, vendor.verified_at = Vendor.VERIFY_VERIFIED, now
                changed += ["verification_status", "verified_at"]
            if changed:
                vendor.save(update_fields=changed)

            for slug, price, unit, availability in shop["listings"]:
                product = Product.objects.get(slug=slug)
                _, created = VendorProduct.objects.update_or_create(
                    vendor=vendor,
                    product=product,
                    variety=None,
                    unit=unit,
                    defaults={
                        "category": product.category,
                        "name": product.name,
                        "price": Decimal(price),
                        "availability": availability,
                        "stock_updated_at": now,
                        "price_updated_at": now,
                    },
                )
                n_listings += created

        self.stdout.write(self.style.SUCCESS(f"demo data: {n_vendors} new vendors, {n_listings} new listings"))
