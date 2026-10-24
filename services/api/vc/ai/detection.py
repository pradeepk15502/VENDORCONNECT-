"""Orchestrates one scan: load the image, call the detection provider, validate what it returned,
and persist the audit record (`AIDetection`). Nothing here ever writes a `VendorProduct` — creating
the listing only happens once the vendor explicitly confirms (`views.AIDetectionConfirmView`,
master prompt §17/§18).
"""

from __future__ import annotations

import time

from django.db.models import Q

from vc.assets.models import MediaAsset
from vc.assets.storage import get_media_storage
from vc.catalog.models import MarketPrice, Product, VendorProduct
from vc.vendors.models import Vendor

from .models import AIDetection, AIModelVersion
from .providers import BAND_NONE, confidence_band, get_default_provider


def _active_model_version(provider) -> AIModelVersion:
    version, _ = AIModelVersion.objects.get_or_create(
        name=provider.name,
        version=provider.version,
        defaults={
            "task": "product_detection",
            "is_active": True,
            "metrics": {
                "is_development": provider.is_development,
                "capabilities": ["barcode", "ocr_alias_match"],
                "not_implemented": ["generic_image_classification"],
            },
        },
    )
    return version


def _clamp_confidence(value) -> float | None:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if confidence != confidence:  # NaN
        return None
    return max(0.0, min(1.0, confidence))


def _sanitize_prediction(candidate) -> dict | None:
    """Re-validates whatever the provider returned against the real catalog rather than trusting it
    — the provider is a structured-data source, not something Django's business data trusts blindly
    (master prompt §5/§20). Accepts either a `providers.Prediction` dataclass or a plain mapping (a
    malformed/rogue provider might return the latter — this is exactly what the "malformed provider
    response" test in §26/§21 exercises)."""

    def get(name, default=None):
        if hasattr(candidate, name):
            return getattr(candidate, name)
        if isinstance(candidate, dict):
            return candidate.get(name, default)
        return default

    confidence = _clamp_confidence(get("confidence"))
    if confidence is None:
        return None

    product_slug = get("product_slug")
    product = None
    if product_slug:
        product = Product.objects.filter(slug=product_slug, is_active=True).select_related("category").first()

    label = get("label") or (product.name if product else None) or get("product_name")
    if not label:
        return None

    variety = None
    variety_id = get("variety_id")
    if product and variety_id:
        variety = product.varieties.filter(id=variety_id).first()

    source = get("source")
    source = source if source in ("barcode", "ocr") else "unknown"

    return {
        "product_slug": product.slug if product else None,
        "product_name": product.name if product else None,
        "variety_id": str(variety.id) if variety else None,
        "variety_name": variety.name if variety else None,
        "category_slug": product.category.slug if product else None,
        "category_name": product.category.name if product else None,
        "unit": product.default_unit if product else None,
        "label": str(label),
        "confidence": round(confidence, 2),
        "band": confidence_band(confidence),
        "source": source,
    }


def _suggest_price(vendor: Vendor, prediction: dict) -> dict | None:
    """Real query against `catalog_marketprice` — currently empty in this environment (no market
    data feed is connected), so this honestly returns None ("Market price unavailable") for every
    detection today. It is not seeded with invented numbers to make this look more complete than it
    is (master prompt §15/§30)."""
    if not prediction.get("product_slug"):
        return None
    qs = MarketPrice.objects.filter(product__slug=prediction["product_slug"])
    variety_id = prediction.get("variety_id")
    qs = (
        qs.filter(Q(variety_id=variety_id) | Q(variety__isnull=True)) if variety_id else qs.filter(variety__isnull=True)
    )

    city = ""
    location = getattr(vendor, "location", None)
    if location is not None:
        city = location.city or ""

    match = None
    if city:
        match = qs.filter(region__iexact=city).order_by("-observed_at").first()
    if match is None:
        match = qs.order_by("-observed_at").first()
    if match is None:
        return None
    return {
        "min": str(match.min_price),
        "max": str(match.max_price),
        "unit": match.unit,
        "region": match.region,
        "source": match.source,
        "observed_at": match.observed_at.isoformat(),
    }


def existing_listing_for(vendor: Vendor, prediction: dict | None) -> dict | None:
    """Master prompt §12 — "Vendor already has X. AI detects X. Suggest: use existing listing"
    instead of quietly heading toward a duplicate. Computed live (not stored at scan time) so it
    reflects the vendor's *current* listings even if they changed since the scan."""
    if not prediction or not prediction.get("product_slug"):
        return None
    qs = VendorProduct.objects.filter(
        vendor=vendor,
        product__slug=prediction["product_slug"],
        status__in=[VendorProduct.STATUS_ACTIVE, VendorProduct.STATUS_PAUSED],
    )
    variety_id = prediction.get("variety_id")
    qs = qs.filter(variety_id=variety_id) if variety_id else qs.filter(variety__isnull=True)
    listing = qs.first()
    return {"id": str(listing.id), "name": listing.name} if listing else None


def message_for(detection: AIDetection) -> str:
    """The plain-language line the confirmation screen leads with (master prompt §16/§33 — no ML
    jargon, no bare percentages)."""
    if detection.status == AIDetection.S_FAILED:
        return "We couldn't process that photo. Try again, or add the product yourself."
    if not detection.predictions:
        return "We couldn't confidently identify this product. Choose it yourself."
    top = detection.predictions[0]
    band = top.get("band", BAND_NONE)
    if band == "likely":
        return f"Looks like {top['label']}."
    if band == "possible":
        return f"Possibly {top['label']}. Please confirm, or choose a different product."
    return "We couldn't confidently identify this product. Choose it yourself."


def run_detection(*, vendor: Vendor, requested_by, image: MediaAsset) -> AIDetection:
    """Synchronous by design (master prompt §7 explicitly allows this for an MVP): the whole
    pipeline is local decode/OCR/DB-lookup work, well under a second, with no network call to wait
    on — there is nothing a background job would buy here today. `provider.detect()` raising *any*
    exception (a stand-in in tests for a future remote provider's timeout/rate-limit/network
    failure) is still handled as a normal failed detection, never a 500."""
    provider = get_default_provider()
    model_version = _active_model_version(provider)
    started = time.monotonic()

    try:
        data = get_media_storage().read(image.storage_key)
    except Exception:
        return AIDetection.objects.create(
            vendor=vendor,
            requested_by=requested_by,
            image=image,
            model_version=model_version,
            status=AIDetection.S_FAILED,
            error="image_unreadable",
        )

    try:
        raw = provider.detect(data)
    except Exception:
        return AIDetection.objects.create(
            vendor=vendor,
            requested_by=requested_by,
            image=image,
            model_version=model_version,
            status=AIDetection.S_FAILED,
            error="provider_error",
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    latency_ms = int((time.monotonic() - started) * 1000)

    if raw.error:
        return AIDetection.objects.create(
            vendor=vendor,
            requested_by=requested_by,
            image=image,
            model_version=model_version,
            status=AIDetection.S_FAILED,
            error=raw.error,
            barcode=raw.barcode[:32],
            ocr_text=raw.ocr_text[:500],
            latency_ms=latency_ms,
        )

    predictions = [p for p in (_sanitize_prediction(c) for c in raw.predictions) if p is not None][:3]
    suggested_price = _suggest_price(vendor, predictions[0]) if predictions else None

    return AIDetection.objects.create(
        vendor=vendor,
        requested_by=requested_by,
        image=image,
        model_version=model_version,
        status=AIDetection.S_DONE,
        predictions=predictions,
        barcode=raw.barcode[:32],
        ocr_text=raw.ocr_text[:500],
        suggested_price=suggested_price,
        latency_ms=latency_ms,
    )
