"""AI product-detection providers (Phase 10; design in docs/AI.md).

**What is real here, and what is not.** This project has no reachable path to a trained image
classifier for the VendorConnect taxonomy:

- No cloud vision/OCR API is reachable from this environment (network policy blocks
  `vision.googleapis.com`, `api.openai.com`, and similar hosts — confirmed by direct testing).
- No pretrained model weights can be downloaded (`huggingface.co` and `download.pytorch.org` are
  both blocked the same way). Only package registries (PyPI) and GitHub are reachable.
- No vendor-consented photo dataset exists yet to train one from scratch (docs/AI.md's own Model
  plan already says this is a prerequisite, not something this phase can shortcut).

Rather than fabricate a result to satisfy that gap — the master prompt is explicit that this is
worse than not having the capability at all — `LocalDetectionProvider` implements exactly the two
sub-tasks that a genuine, already-installed, non-fake local capability *can* do:

1. **Barcode decoding** (`pyzbar`, backed by the system's `libzbar`) against `catalog.Product.barcode`.
2. **OCR** (`pytesseract`, backed by the system's `tesseract-ocr`) against `catalog.ProductAlias`,
   reusing the exact same trigram-similarity matching Postgres already does for search
   (`vc/catalog/search.py`) instead of a second, parallel matching implementation.

Generic image classification ("what does this loose vegetable look like") is *not* implemented,
because no real model for it is available here — this provider correctly returns no prediction for
a photo with no barcode and no legible printed text, per the master prompt's §6: "If a capability
is not reliably available: return 'Unable to confidently identify this product' rather than
inventing a result." A future production provider (a real trained/hosted classifier) is a drop-in
replacement for `ProductDetectionProvider` — see `get_default_provider()`.

`is_development = True` on every provider currently registered here means exactly what it says: no
implementation in this file is presented to a vendor as a production AI model. The vendor-facing UI
and the stored `AIModelVersion`/`AIDetection` rows both carry this flag through unchanged.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Protocol

import pytesseract
from django.contrib.postgres.search import TrigramSimilarity
from PIL import Image, UnidentifiedImageError
from pyzbar.pyzbar import decode as zbar_decode

from vc.catalog.models import Product, ProductAlias, ProductVariety
from vc.catalog.text import normalize_text

logger = logging.getLogger(__name__)

# Confidence bands (master prompt §16 — plain labels, never a bare percentage).
BAND_LIKELY, BAND_POSSIBLE, BAND_NONE = "likely", "possible", "none"
LIKELY_THRESHOLD = 0.6
POSSIBLE_THRESHOLD = 0.4

# A barcode hit is an exact catalog lookup, not a similarity score — a fixed high confidence
# reflects "this code is genuinely on file for this product," not a guess. Kept below 1.0 because a
# barcode can still be misassigned in the catalog; it is not literal certainty.
BARCODE_MATCH_CONFIDENCE = 0.97

# A normalized OCR token shorter than this is too noisy to match against (single letters, stray
# OCR artefacts); trigram similarity on very short strings is unreliable.
MIN_TOKEN_LENGTH = 3


def confidence_band(confidence: float) -> str:
    if confidence >= LIKELY_THRESHOLD:
        return BAND_LIKELY
    if confidence >= POSSIBLE_THRESHOLD:
        return BAND_POSSIBLE
    return BAND_NONE


@dataclass(frozen=True)
class Prediction:
    """One candidate product for a scan. Matches docs/AI.md's `Prediction` shape plus the extra
    category/unit/source fields the master prompt's §19 audit record asks for."""

    product_slug: str | None
    product_name: str | None
    variety_id: str | None
    variety_name: str | None
    label: str
    confidence: float
    source: str  # "barcode" | "ocr"


@dataclass
class DetectionResult:
    predictions: list[Prediction] = field(default_factory=list)
    barcode: str = ""
    ocr_text: str = ""
    error: str = ""


class ProductDetectionProvider(Protocol):
    """Matches docs/AI.md's `ProductClassifier` Protocol. Django (this app) resolves authorization,
    validation, taxonomy mapping and persistence; a provider only ever returns structured data — it
    never touches `VendorProduct` or any other business table directly (master prompt §5)."""

    name: str
    version: str
    is_development: bool

    def detect(self, image_bytes: bytes) -> DetectionResult: ...


class LocalDetectionProvider:
    """The only detection provider implemented in this environment. See module docstring for
    exactly what is real (barcode + OCR + taxonomy matching) and what is deliberately not attempted
    (generic visual classification of an unlabelled product)."""

    name = "vendorconnect-local-detector"
    version = "1.0"
    is_development = True

    def detect(self, image_bytes: bytes) -> DetectionResult:
        result = DetectionResult()
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
        except (UnidentifiedImageError, OSError):
            result.error = "unreadable_image"
            return result

        barcode_value = self._decode_barcode(image)
        if barcode_value:
            result.barcode = barcode_value
            hit = self._match_barcode(barcode_value)
            if hit:
                result.predictions.append(hit)

        ocr_text = self._read_text(image)
        result.ocr_text = ocr_text
        if ocr_text:
            known = {(p.product_slug, p.variety_id) for p in result.predictions}
            for hit in self._match_text(ocr_text):
                key = (hit.product_slug, hit.variety_id)
                if key not in known:
                    result.predictions.append(hit)
                    known.add(key)

        result.predictions.sort(key=lambda p: p.confidence, reverse=True)
        result.predictions = result.predictions[:3]
        return result

    @staticmethod
    def _decode_barcode(image: Image.Image) -> str:
        try:
            hits = zbar_decode(image)
        except Exception:  # a corrupt/unsupported frame must not take down the whole scan
            logger.warning("ai.barcode_decode_failed", exc_info=True)
            return ""
        return hits[0].data.decode("utf-8", "ignore") if hits else ""

    @staticmethod
    def _read_text(image: Image.Image) -> str:
        try:
            text = pytesseract.image_to_string(image)
        except Exception:  # tesseract missing/misconfigured must not take down the whole scan
            logger.warning("ai.ocr_failed", exc_info=True)
            return ""
        return text.strip()

    @staticmethod
    def _match_barcode(code: str) -> Prediction | None:
        product = Product.objects.filter(barcode=code, is_active=True).select_related("category").first()
        if not product:
            return None
        return Prediction(
            product_slug=product.slug,
            product_name=product.name,
            variety_id=None,
            variety_name=None,
            label=product.name,
            confidence=BARCODE_MATCH_CONFIDENCE,
            source="barcode",
        )

    @staticmethod
    def _match_text(text: str) -> list[Prediction]:
        normalized = normalize_text(text)
        if not normalized:
            return []
        tokens = {t for t in {normalized, *normalized.split()} if len(t) >= MIN_TOKEN_LENGTH}
        if not tokens:
            return []

        best: dict[str, tuple[float, ProductAlias]] = {}
        for token in tokens:
            hits = (
                ProductAlias.objects.annotate(sim=TrigramSimilarity("normalized", token))
                .filter(sim__gt=POSSIBLE_THRESHOLD)
                .select_related("product", "product__category")
                .order_by("-sim")[:5]
            )
            for alias in hits:
                pid = str(alias.product_id)
                if pid not in best or alias.sim > best[pid][0]:
                    best[pid] = (alias.sim, alias)

        predictions = []
        for sim, alias in best.values():
            product = alias.product
            variety = _mentioned_variety(product, normalized)
            predictions.append(
                Prediction(
                    product_slug=product.slug,
                    product_name=product.name,
                    variety_id=str(variety.id) if variety else None,
                    variety_name=variety.name if variety else None,
                    label=product.name,
                    confidence=round(float(sim), 2),
                    source="ocr",
                )
            )
        predictions.sort(key=lambda p: p.confidence, reverse=True)
        return predictions[:3]


def _mentioned_variety(product: Product, normalized_text: str) -> ProductVariety | None:
    for variety in product.varieties.all():
        if normalize_text(variety.name) in normalized_text:
            return variety
    return None


def get_default_provider() -> ProductDetectionProvider:
    """No trained/hosted model is reachable from this environment yet (see module docstring) —
    always the local barcode+OCR provider. A real future provider (an ONNX classifier, or a hosted
    vision API once the organization's network policy allows one) is a drop-in replacement: add the
    class here and return it instead, without changing any caller (`vc/ai/detection.py`,
    `vc/ai/views.py`) or the API contract — the same shape `get_payment_provider()` and
    `get_media_storage()` already use elsewhere in this codebase."""
    return LocalDetectionProvider()
