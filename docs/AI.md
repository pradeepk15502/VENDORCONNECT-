# VendorConnect — AI product detection (design; implemented in Phase 10)

## Principle
AI is **advisory**. It never creates, publishes or reprices a listing. The vendor confirms product,
type, price, stock and unit; only the confirm endpoint writes a `VendorProduct`.

## Flow
```
Vendor app camera → upload image (MediaAsset, EXIF stripped)
  → POST /api/v1/ai/detections {image_id}            (API stores ai_detection: pending)
  → API → AI service /v1/classify (image URL, vendor city)
      1. barcode decoder (packaged goods) → catalog.Product.barcode match
      2. OCR (brand/label text) → alias trigram match
      3. image classifier → top-k over the VendorConnect taxonomy (product + variety)
  → merge → top 3 suggestions with confidence + suggested unit
  → price suggestion from catalog_marketprice (region, freshest, with source + observed_at)
  → vendor screen: "Looks like Tomato (Hybrid) · kg · Market ₹28–₹32/kg (source, date)"
  → vendor edits/confirms → POST /api/v1/ai/detections/{id}/confirm → VendorProduct(source="ai")
```
Low confidence (<0.5) → show "Choose product" list prefilled with the top matches instead of a single guess.

## Service boundary
`services/ai` is a separate container (Python, FastAPI) behind an internal URL, so model upgrades and
GPU/CPU sizing don't touch the API. Interface:
```python
class ProductClassifier(Protocol):
    version: str
    def classify(self, image: bytes, k: int = 5) -> list[Prediction]: ...  # (product_slug, variety, confidence)
```
Implementations: `MockClassifier` (tests/dev, deterministic) → `OnnxClassifier` (production CPU) → optional
hosted vision-LLM fallback. The active model is recorded in `ai_aimodelversion`; every detection stores
`model_version` and latency.

## Model plan
- **Taxonomy:** start with the 52 products in `taxonomy.json` (fruit/veg varieties first — no barcodes).
- **Baseline:** fine-tune a small mobile backbone (e.g. MobileNetV3 / EfficientNet-Lite) exported to ONNX;
  target <150 ms CPU inference.
- **Data:** public produce datasets + photos collected in-app **with vendor consent**; every confirmation
  where the vendor corrected the suggestion (`vendor_corrected=true`) becomes a labelled example.
- **Evaluation gate:** top-3 accuracy per class on a held-out set of real shop photos; a new version is
  activated only if it beats the current one.

## Price suggestion
Range = recent market data for the product/variety in the vendor's region. Candidate source for produce:
Government of India Agmarknet mandi prices (wholesale → apply a documented retail markup band). Always show
source and date; never overwrite the vendor's price.

## Failure handling
Timeout (3 s) or error → "Couldn't recognise. Choose the product yourself." with manual picker; the
detection is stored as `failed` for monitoring. Invalid image (type/size/blur) → specific message.
