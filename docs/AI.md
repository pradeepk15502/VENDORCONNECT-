# VendorConnect — AI-assisted product entry (Phase 10, as built)

This document describes what actually ships, not a plan. See `docs/ARCHITECTURE.md` D31 for why the
implementation departs from the original D15 design, and why that departure is a reasoned amendment
rather than a shortcut.

## Principle (unchanged from the original design)
AI is **advisory only**. It never creates, publishes or reprices a listing, and it never overwrites
a vendor-entered price, stock level, product name or any other business data. Only the vendor's
explicit "Add Product" tap writes a `VendorProduct` — the confirm endpoint reuses the exact same
create path a manual listing goes through (`VendorProductCreateSerializer`), so an AI-assisted
listing and a manual one are indistinguishable in the database except for `source="ai"` and the
linked `AIDetection` audit row.

## What the current provider actually does
`vc/ai/providers.py::LocalDetectionProvider` is what `get_default_provider()` returns today. It is
explicitly and permanently labelled a development provider (`is_development = True`, surfaced in
every API response and shown to the vendor as a "Development scanner" disclosure) — it is real
software doing real work, not a placeholder, but it is not a trained image classifier and must never
be presented as one.

**Capabilities (real):**
- **Barcode decoding** — `pyzbar` reads a real barcode from the uploaded photo (EAN-13, etc.) and
  matches it against `catalog.Product.barcode`. A match is scored at a fixed high confidence
  (`BARCODE_MATCH_CONFIDENCE = 0.97`) because it is a deterministic lookup, not a similarity guess.
- **OCR** — `pytesseract` runs real Tesseract OCR over the photo, and the extracted text is matched
  against the product taxonomy using the same trigram alias search (`TrigramSimilarity` over
  `ProductAlias.normalized`) that powers `/search` (Phase 3). A product's varieties are checked for
  an explicit mention in the OCR text (e.g. "Hybrid", "Desi") so a label naming a specific variety is
  matched to that variety, not just the generic product.
- **Category/unit/existing-listing context** — every prediction carries the matched product's real
  category and unit, and the response tells the vendor whether they already have an active or paused
  listing for that product/variety, computed live at read time.
- **Market price context** — a real (currently empty) `MarketPrice` table is queried, preferring the
  vendor's own city and falling back to the most recent record overall; if nothing is found the
  vendor sees "Market price unavailable," never an invented number.

**Not implemented (and why that's the honest answer, not a bug):**
- **Generic visual product recognition** — there is no trained image classifier. A photo with no
  barcode and no legible text produces an honest empty result ("We couldn't confidently identify this
  product") rather than a guess. This is a direct consequence of environment constraints, detailed
  below, not a scope decision made for convenience.

## Why there's no trained classifier here
This was verified directly, not assumed: every route this environment could use to obtain or call a
generic image classifier is blocked by the network allowlist.
- Pretrained-model sources — `huggingface.co`, `download.pytorch.org` — reject the connection
  (`connect_rejected`, organization policy).
- Hosted vision APIs — `api.openai.com`, `vision.googleapis.com` — reject the connection the same way.
- `pypi.org` is reachable, so ordinary Python packages install fine (this is how `pytesseract`,
  `pyzbar` and their test-only fixture-generation dependency `python-barcode` were installed) — but a
  pip package does not include a multi-megabyte pretrained model file, and there is no way to fetch
  one separately.

What *is* genuinely available and real in this environment: system `tesseract-ocr` (OCR) and
`libzbar0`/`libzbar0t64` (barcode decoding), both installed via apt and both fully functional. That
is the actual, honest capability boundary this phase builds against — real OCR and barcode
recognition, no generic image classification.

## Architecture
```
Vendor app camera/upload → POST /api/v1/media (existing Phase-9 pipeline; EXIF stripped)
  → POST /api/v1/ai/detections {image_id}
      vc/ai/detection.py::run_detection():
        1. loads the real image bytes from the existing MediaStorage abstraction
        2. calls provider.detect(bytes) inside try/except — ANY exception → status="failed",
           never a 500 and never a fake successful result
        3. re-validates every returned prediction against the real DB (product/variety lookups,
           confidence clamped to [0, 1]) before trusting it — vc/ai/detection.py::_sanitize_prediction
        4. computes a price suggestion (real MarketPrice query or null) for the top prediction
        5. persists one AIDetection row: predictions, barcode, ocr_text, suggested_price, status
  → GET /api/v1/ai/detections/{id} — vendor-scoped; existing_listing/price freshness computed live
  → vendor reviews, edits anything, taps "Add Product"
  → POST /api/v1/ai/detections/{id}/confirm
      reuses VendorProductCreateSerializer verbatim (the same one manual Add Product uses),
      wrapped in transaction.atomic() so a duplicate-listing conflict rolls back cleanly;
      sets VendorProduct.source="ai", records vendor_corrected by comparing the vendor's final
      product/variety against the detection's top prediction, and rejects a second confirm of the
      same detection (409 detection_already_used)
  → GET /api/v1/vendors/me/ai-detections — the vendor's own detection history (audit trail)
  → GET /api/v1/admin/ai/detections — staff-only cross-vendor visibility (list + status filter),
    surfaced in the admin app's "AI Scans" sidebar section (apps/admin/src/App.tsx) — read-only,
    no actions, since confirm/reject already happened on the vendor's own device
```
No separate product database exists for AI results — `AIDetection` is a pure audit/staging record
(`vc.ai.models`, unchanged from the Phase 0 schema; no migration was needed for Phase 10) that
points at a `VendorProduct` once confirmed. There is exactly one product database, as required.

## Confidence, in plain language
Raw similarity/lookup scores are never shown to a vendor as a bare percentage. They're bucketed:

| Band | Threshold | Vendor sees |
|---|---|---|
| Likely | confidence ≥ 0.6 | "Looks like **Tomato**." |
| Possible | 0.4 ≤ confidence < 0.6 | "Possibly **Tomato**? Please confirm." |
| None | confidence < 0.4, or no prediction at all | "We couldn't confidently identify this product." |

An expandable "Show details" control on the confirm screen reveals the raw confidence value and
whether the match came from the barcode or from OCR, for a vendor who wants to see the mechanics —
never surfaced by default.

## Price suggestion
Sourced only from real `MarketPrice` rows; there is no ingestion pipeline populating that table yet
(no Agmarknet or equivalent feed is wired up), so in this build every price suggestion is honestly
"unavailable." The lookup, freshness display and "never overwrites the vendor's price" behaviour are
fully implemented and tested against seeded `MarketPrice` rows — wiring up a real feed is a data
problem, not a code problem, and does not touch this path when it happens.

## Failure handling
Every failure mode in the master prompt's test matrix is handled without ever faking a successful
detection: provider exception/timeout, malformed provider response, unsupported/empty image, no
detection, low confidence, and a network/transport failure on the frontend all resolve to either a
`status="failed"` detection (with an honest message and `[Try Again] / [Add Manually]`) or, for a
request that never reached the server at all, staying on the scan screen with the same two actions.
None of these paths navigate to a fabricated result.

## Rate limiting (Phase 12)
`POST /ai/detections` is real CPU-bound inference (Tesseract OCR + zbar barcode decode per call, not
a cheap CRUD write), so it carries its own throttle scope — `ai_detection`, 30/hour per authenticated
vendor (`THROTTLE_AI_DETECTION` env var) — separate from the generic per-user API budget. A vendor
past the limit gets the same `429` / `rate_limited` envelope every other throttled endpoint returns,
with `details.retry_after_seconds`, not a silent failure or a fake detection.

## Runtime verification: proving the OS-level dependencies, not just the Python code
`pytest` runs inside this repo's own `.venv`, where `tesseract-ocr`/`libzbar0` happen to already be
installed on the host — it can prove `vc/ai`'s Python code is correct, but it cannot prove a *built
container image* actually has those OS packages. A Dockerfile with the right Python dependencies
(`pytesseract`, `pyzbar`) but a missing or wrong system package would pass every unit test and still
fail on every real request. Two things close that gap:

- **`services/api/Dockerfile`** explicitly installs `tesseract-ocr tesseract-ocr-eng libzbar0` in its
  shared `base` stage (both `dev` and `prod` inherit it). `tesseract-ocr-eng` is listed explicitly
  rather than left to transitive resolution — verified via `apt-cache depends tesseract-ocr` to be a
  hard `Depends` on this environment's Debian/Ubuntu base, but a Python-package-only dependency check
  can't see that, and a `tesseract` binary with no language data installed produces empty OCR output
  silently rather than erroring, which is exactly the kind of quiet failure this project avoids
  shipping.
- **`services/api/scripts/ai_smoke_test.py`** is a real, black-box HTTP smoke test — stdlib only (no
  `requests`, so it adds no dependency and runs against a bare-bones freshly built image) — that
  drives the entire vendor-facing flow against a *running instance*: health check, real signup, real
  image upload, real OCR text back (`"TAMATAR"` from a real rendered label fixture), real barcode
  decode (a real EAN-13 fixture, `python-barcode`-generated), real taxonomy match, real confirm →
  `VendorProduct` creation, and a real cross-vendor 404 check. It asserts on real returned text/values,
  not on status codes alone, so it fails loudly if OCR or barcode decoding silently produce nothing.
  It is wired into CI as the `ai-runtime-smoke-test` job (`.github/workflows/ci.yml`): the job builds
  the actual `dev`-target Docker image (`load: true`, no registry push needed) and runs this script
  against the running container, gating the `docker`/deploy jobs on it passing.

**An operationally important asymmetry, found while building this and worth documenting**: `pyzbar`
loads `libzbar.so.0` via `ctypes.cdll.LoadLibrary` at **import time**. A container missing `libzbar0`
therefore fails to boot at all — the whole Django process crashes before serving a single request —
verified directly by removing the library and restarting the server process fresh (an already-running
process keeps the library mapped in memory even after its file is deleted, so this must be tested with
a genuine fresh-process restart, not just a file removal). `pytesseract`, by contrast, only shells out
to the `tesseract` binary lazily, per OCR request; a container missing `tesseract-ocr` boots fine and
silently returns empty OCR text instead of erroring. A missing barcode library is a loud, immediate
outage; a missing OCR binary is a quiet, partial one. Both are covered by the Dockerfile fix above, but
an operator debugging a future regression should know that "the app won't start" and "OCR just doesn't
work" point to the same class of problem (a missing OS package) with very different symptoms.

**Docker build verification itself remains environment-blocked in this sandbox**, distinct from the
above: this sandbox's network policy rejects every `docker.io` registry pull with `403 Forbidden`,
confirmed down to the buildkit `# syntax=docker/dockerfile:1.7` frontend-directive pull — `docker
build` fails before it can even resolve `FROM python:3.11-slim-bookworm`, a structural sandbox
constraint, not a missing-daemon issue and not something this phase can work around locally. The
Dockerfile content above has been reviewed and is believed correct; an actual `docker build` + boot +
smoke-test run must happen in CI or an unrestricted environment to confirm it, and that confirmation —
not this document — is what makes Phase 10's Docker status COMPLETE rather than PARTIAL.

**Phase 13 update**: this exact smoke test was re-run — not against the Docker image (see below), but
directly against a `manage.py runserver` instance on this session's own sandbox host — and passed every
step end-to-end (real OCR text `"TAMATAR HYBRID"`, real barcode `4006381333931` decoded, real
cross-vendor 404), confirming the application-level runtime path still works. The Docker constraint
itself was also re-verified rather than assumed carried over from Phase 10, and it has gotten *more*
restrictive, not less: this session's Docker daemon cannot start at all (`Cannot connect to the Docker
daemon`, `ulimit: error setting limit (Operation not permitted)`), a structural difference from Phase
10's "daemon runs, registry pulls are 403'd" finding — sandbox instances of this kind evidently vary
run to run. Either way, `docker build`/boot verification of the actual image remains something only a
real CI runner or an unrestricted environment can confirm; see `docs/ARCHITECTURE.md` D34 for the full
Phase 13 account.

## Future model-replacement strategy
Swapping in a real trained model later requires no change to the API, the confirm flow, the audit
schema, or the frontend — only:
1. A new class implementing `ProductDetectionProvider` (`vc/ai/providers.py`) — e.g. an ONNX model
   loaded from a licensed source, or a hosted vision API once one is reachable from this environment.
2. `get_default_provider()` updated to return it, with `is_development` set correctly for whatever
   that provider actually is.
3. If the new model is large enough to warrant independent scaling/GPU lifecycle, reconsider D31's
   in-process decision and split it into its own service at that point — not before, and not on
   spec.
`AIModelVersion` (Phase 0 schema, already used) records which provider/version produced each
detection, so a rollout can be compared against the previous provider's real `vendor_corrected` rate
before being made the default.

## Deferred out of this phase
- A trained generic image classifier — blocked by this environment's network policy (see above), not
  a scope choice.
- A real market-price data feed (e.g. Agmarknet) — the lookup path is real and tested; no source is
  ingested yet.
- A separate `services/ai` process — revisit if/when a real model needs independent scaling.
- A verified `docker build`/boot of the production image in this sandbox — blocked by network policy
  (see "Runtime verification" above), pending CI or an unrestricted environment.

The admin-facing page for `GET /admin/ai/detections` ("AI Scans" in the admin sidebar) is no longer
deferred — it shipped in the Phase 10 hardening pass; see "Architecture" above and
`docs/ARCHITECTURE.md` D31.
