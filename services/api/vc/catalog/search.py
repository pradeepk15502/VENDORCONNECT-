"""Product/vendor search — ARCHITECTURE.md D10.

Pipeline: normalise the query -> resolve it to product concepts via alias trigram similarity
(handles typos, Hindi script and transliteration) -> geo-filter listings with ST_DWithin on the
vendor's location -> rank by a transparent weighted score (relevance, in-stock, open, distance,
freshness, rating). No paid placement.

`SearchBackend` is a small interface so a future OpenSearch (or other) backend can replace
`PostgresSearchBackend` without changing the API contract in `catalog/views.py` — the view only
ever calls `get_search_backend().search(query)`.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import Max

from vc.vendors.freshness import freshness
from vc.vendors.models import Vendor

from .models import ProductAlias, VendorProduct
from .text import normalize_text

# Trigram similarity is 0..1; below these thresholds a match is considered noise, not a hit.
ALIAS_SIMILARITY_THRESHOLD = 0.25
CUSTOM_NAME_SIMILARITY_THRESHOLD = 0.3
# Safety valve on candidate fan-out before Python-side ranking — generous for hyperlocal scale.
CANDIDATE_LIMIT = 500

# Weights sum to 1.0 and are listed in the same priority order as ARCHITECTURE D10.
WEIGHTS = {
    "relevance": 0.35,
    "in_stock": 0.20,
    "open": 0.15,
    "distance": 0.15,
    "freshness": 0.10,
    "rating": 0.05,
}
_AVAILABILITY_SCORE = {
    VendorProduct.AVAIL_IN_STOCK: 1.0,
    VendorProduct.AVAIL_LOW: 0.5,
    VendorProduct.AVAIL_OUT: 0.0,
}
_FRESHNESS_SCORE = {"fresh": 1.0, "aging": 0.5, "stale": 0.0}


@dataclass(frozen=True)
class SearchQuery:
    point: Point
    radius_km: float
    q: str = ""
    category_slug: str | None = None
    # Phase 6 filters (ARCHITECTURE D26) — all opt-in/off by default, so the unfiltered default
    # behavior (closed shops and low/out-of-stock listings shown, just ranked lower — D9) never
    # changes unless the customer explicitly asks to narrow results.
    in_stock_only: bool = False
    open_now: bool = False
    delivery: bool = False
    pickup: bool = False
    price_min: Decimal | None = None
    price_max: Decimal | None = None


@dataclass(frozen=True)
class SearchResult:
    listing: VendorProduct
    relevance: float  # 0..1; 1.0 when there is no text query (category/browse ranking only)
    distance_km: float


class SearchBackend(Protocol):
    def search(self, query: SearchQuery) -> list[SearchResult]: ...


def _score(result: SearchResult, radius_km: float) -> float:
    listing = result.listing
    proximity = max(0.0, 1 - (result.distance_km / radius_km)) if radius_km > 0 else 0.0
    fresh = _FRESHNESS_SCORE[freshness(listing.stock_updated_at, listing.category)]
    rating = float(listing.vendor.rating_avg) / 5 if listing.vendor.rating_count else 0.0
    return (
        WEIGHTS["relevance"] * result.relevance
        + WEIGHTS["in_stock"] * _AVAILABILITY_SCORE[listing.availability]
        + WEIGHTS["open"] * (1.0 if listing.vendor.is_open else 0.0)
        + WEIGHTS["distance"] * proximity
        + WEIGHTS["freshness"] * fresh
        + WEIGHTS["rating"] * rating
    )


class PostgresSearchBackend:
    """Default `SearchBackend`: pg_trgm alias resolution + PostGIS distance + Python-side ranking."""

    def search(self, query: SearchQuery) -> list[SearchResult]:
        listing_ids, relevance_by_id = self._resolve(query.q)

        qs = (
            VendorProduct.objects.filter(status=VendorProduct.STATUS_ACTIVE, vendor__status=Vendor.STATUS_ACTIVE)
            .select_related("vendor", "vendor__location", "vendor__delivery", "product", "category")
            .annotate(distance=Distance("vendor__location__point", query.point))
            .filter(vendor__location__point__distance_lte=(query.point, D(km=query.radius_km)))
        )
        if listing_ids is not None:
            qs = qs.filter(id__in=listing_ids)
        if query.category_slug:
            qs = qs.filter(category__slug=query.category_slug)
        if query.in_stock_only:
            qs = qs.exclude(availability=VendorProduct.AVAIL_OUT)
        if query.open_now:
            qs = qs.filter(vendor__is_open=True)
        if query.delivery:
            qs = qs.filter(vendor__delivery__delivery_enabled=True)
        if query.pickup:
            qs = qs.filter(vendor__delivery__pickup_enabled=True)
        if query.price_min is not None:
            qs = qs.filter(price__gte=query.price_min)
        if query.price_max is not None:
            qs = qs.filter(price__lte=query.price_max)
        qs = qs.order_by("distance")[:CANDIDATE_LIMIT]

        results = [
            SearchResult(
                listing=listing, relevance=relevance_by_id.get(listing.id, 1.0), distance_km=listing.distance.km
            )
            for listing in qs
        ]
        results.sort(key=lambda r: _score(r, query.radius_km), reverse=True)
        return results

    @staticmethod
    def _resolve(raw_q: str) -> tuple[set | None, dict]:
        """Returns (matching listing ids or None for "no text filter", relevance by listing id)."""
        q = normalize_text(raw_q)
        if not q:
            return None, {}

        # Catalog products: resolved via alias trigram similarity (covers the product's own name,
        # synonyms, Hindi native name and transliterations — seed_taxonomy files all of these as
        # ProductAlias rows, so this one query is the whole "typo/Hindi-tolerant" resolution step).
        alias_hits = (
            ProductAlias.objects.annotate(sim=TrigramSimilarity("normalized", q))
            .filter(sim__gt=ALIAS_SIMILARITY_THRESHOLD)
            .values("product_id")
            .annotate(best=Max("sim"))
        )
        relevance_by_product = {row["product_id"]: row["best"] for row in alias_hits}
        relevance_by_id: dict = {}
        if relevance_by_product:
            catalog_listings = VendorProduct.objects.filter(product_id__in=relevance_by_product).values_list(
                "id", "product_id"
            )
            relevance_by_id.update({lid: relevance_by_product[pid] for lid, pid in catalog_listings})

        # Custom listings (no catalog `product`) aren't aliased — match their own display name.
        custom_hits = (
            VendorProduct.objects.filter(product__isnull=True)
            .annotate(sim=TrigramSimilarity("name", q))
            .filter(sim__gt=CUSTOM_NAME_SIMILARITY_THRESHOLD)
            .values_list("id", "sim")
        )
        relevance_by_id.update(dict(custom_hits))

        return set(relevance_by_id), relevance_by_id


def get_search_backend() -> SearchBackend:
    return PostgresSearchBackend()
