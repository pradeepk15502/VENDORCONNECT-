import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from vc.catalog.models import Category, Product, ProductAlias, ProductVariety
from vc.catalog.text import normalize_text

DATA = Path(__file__).resolve().parents[2] / "data" / "taxonomy.json"


class Command(BaseCommand):
    help = "Load/refresh categories, product concepts, varieties and multilingual aliases (idempotent)."

    @transaction.atomic
    def handle(self, *args, **opts):
        data = json.loads(DATA.read_text(encoding="utf-8"))
        cats = {}
        for i, c in enumerate(data["categories"]):
            cats[c["slug"]], _ = Category.objects.update_or_create(
                slug=c["slug"],
                defaults={
                    "name": c["name"],
                    "names_i18n": {"hi": c["hi"]},
                    "icon": c.get("icon", ""),
                    "sort_order": i,
                    "freshness_aging_hours": c.get("aging"),
                    "freshness_stale_hours": c.get("stale"),
                },
            )
        n_alias = 0
        for p in data["products"]:
            product, _ = Product.objects.update_or_create(
                slug=p["slug"],
                defaults={
                    "name": p["name"],
                    "names_i18n": {"hi": p["hi"]},
                    "category": cats[p["cat"]],
                    "default_unit": p["unit"],
                },
            )
            for v in p.get("varieties", []):
                ProductVariety.objects.get_or_create(product=product, name=v)
            texts = [(p["name"], "en", ProductAlias.KIND_SYNONYM), (p["hi"], "hi", ProductAlias.KIND_NATIVE)]
            texts += [
                (a, "hi" if any("ऀ" <= ch <= "ॿ" for ch in a) else "en", ProductAlias.KIND_TRANSLITERATION)
                for a in p.get("aliases", [])
            ]
            for text, lang, kind in texts:
                _, created = ProductAlias.objects.get_or_create(
                    product=product,
                    normalized=normalize_text(text),
                    defaults={"text": text, "lang": lang, "kind": kind},
                )
                n_alias += created
        self.stdout.write(
            self.style.SUCCESS(
                f"taxonomy {data['version']}: {len(cats)} categories, {len(data['products'])} products, {n_alias} new aliases"
            )
        )
