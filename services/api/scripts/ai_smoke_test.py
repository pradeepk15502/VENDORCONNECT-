#!/usr/bin/env python3
"""Phase 10 AI runtime smoke test — a real, black-box HTTP check that a *running instance* of the
API (typically the built Docker image, not this repo's dev virtualenv) actually has the OS-level
`tesseract`/`libzbar` runtime this app's `vc/ai` code depends on, and that the whole vendor-facing
pipeline works end to end against it.

Why this exists, distinct from `pytest`: the Django test suite (`services/api/vc/ai/tests/`) proves
the *application code* is correct, but it runs inside this repo's own `.venv` — it never proves that
a *built container image* actually has `tesseract-ocr`/`libzbar0` installed at the OS level. A
Dockerfile that installs the right Python packages but is missing (or has the wrong) system packages
would pass every pytest and still 500 on every real request. This script is the thing that actually
proves the built image works, by talking to it purely over HTTP — no Django internals, no ORM, no
test client, stdlib only (no extra dependency to add just for this).

It exercises, in order:
  1. the API is reachable                                   (GET /health)
  2. AI dependencies import + are callable inside the image  (implied by steps 6-7 succeeding: a
     missing tesseract/zbar produces a real `status: "failed"` detection, which this script treats
     as a hard failure, not a soft one)
  3/4. tesseract is callable / pyzbar+zbar is callable        (asserted directly: real `ocr_text` /
     `barcode` fields come back populated with the fixture's real, known content)
  5. the AI detection endpoint is reachable                  (POST /ai/detections)
  6. an authenticated vendor can submit an image             (real phone+OTP signup, real shop)
  7. OCR/barcode detection works                             (real fixture images, real Tesseract/
     zbar output, not mocked)
  8. the result reaches the taxonomy/product matching layer  (a real "Tomato" prediction)
  9. vendor confirmation creates the normal VendorConnect
     product/listing                                          (POST .../confirm -> GET /vendor-products)
  10. no unauthorized vendor access is possible               (a second vendor gets 404, never the
      first vendor's detection or the ability to confirm it)

Nothing here depends on a hosted AI service — every check is against this project's own real,
in-process barcode/OCR provider (see docs/AI.md for exactly what that provider does and does not do).

Usage (against a running instance, e.g. after `docker compose up` or `run-stack.sh start`):
    python scripts/ai_smoke_test.py --base-url http://localhost:8000/api/v1

One-time setup this script needs from its caller (documented, not hidden): the seeded catalog has
no product barcodes by default (real production catalogs wouldn't either, until a vendor's real
product data includes one) — so for step 7's barcode check, whoever runs this script against a
freshly-seeded database must first give the seeded "tomato" product the exact barcode this script's
fixture image encodes. Not done automatically here because this script is deliberately a pure HTTP
client with zero DB/ORM access, exactly so it can be pointed at *any* running instance from outside.
Do this once, before running the script, e.g.:
    python manage.py shell -c "
    from vc.catalog.models import Product
    p = Product.objects.get(slug='tomato'); p.barcode = '4006381333931'; p.save()"
Exit code is non-zero on any failure — designed to gate CI, not just print a report.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import random
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlsplit


def _health_url(base_url: str) -> str:
    """/health lives outside /api/v1 — derive its absolute URL from the base's scheme+host rather
    than a fragile relative `../` join (which depends on exactly how many path segments base_url has)."""
    parts = urlsplit(base_url)
    return f"{parts.scheme}://{parts.netloc}/health"


FIXTURES = Path(__file__).parent / "ai_smoke_fixtures"
LABEL_IMAGE = FIXTURES / "label-tamatar-hybrid.png"
BARCODE_IMAGE = FIXTURES / "barcode-tomato.png"
EXPECTED_BARCODE = "4006381333931"


class SmokeTestFailed(RuntimeError):
    pass


class Client:
    """Tiny stdlib-only HTTP client — deliberately not `requests`: this script must run against a
    bare-bones environment (a freshly built container, a CI runner) with no extra pip installs."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/") + "/"
        self.access_token: str | None = None

    def _headers(self, extra: dict | None = None) -> dict:
        h = {"Accept": "application/json"}
        if self.access_token:
            h["Authorization"] = f"Bearer {self.access_token}"
        if extra:
            h.update(extra)
        return h

    def request(self, method: str, path: str, *, json_body=None, data=None, headers=None, expect=None):
        url = urljoin(self.base_url, path.lstrip("/"))
        body = None
        req_headers = self._headers(headers)
        if json_body is not None:
            body = json.dumps(json_body).encode()
            req_headers["Content-Type"] = "application/json"
        elif data is not None:
            body = data
        req = urllib.request.Request(url, data=body, headers=req_headers, method=method)  # noqa: S310 (url is base_url the operator passed on the CLI, not attacker input)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (same trusted base_url; this script's whole job is to be an HTTP client)
                status_code = resp.status
                payload = resp.read()
        except urllib.error.HTTPError as exc:
            status_code = exc.code
            payload = exc.read()
        text = payload.decode("utf-8", errors="replace")
        parsed = None
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                pass
        if expect is not None and status_code != expect:
            raise SmokeTestFailed(f"{method} {path} -> {status_code} (expected {expect}): {text[:500]}")
        return status_code, parsed

    def multipart_upload(self, path: str, field: str, filename: str, content: bytes, expect=201):
        boundary = uuid.uuid4().hex
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts = [
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            content,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        body = b"".join(p if isinstance(p, bytes) else p.encode() for p in parts)
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        return self.request("POST", path, data=body, headers=headers, expect=expect)


def step(label: str):
    print(f"-> {label}", flush=True)


def ok(label: str):
    print(f"   OK  {label}", flush=True)


def signup_vendor(client: Client, shop_name: str) -> dict:
    phone = "+9198" + "".join(random.choices("0123456789", k=8))  # noqa: S311 (a unique test phone number, not a security-relevant secret)
    status_code, body = client.request("POST", "/auth/otp/request", json_body={"phone": phone}, expect=200)
    dev_otp = body.get("dev_otp")
    if not dev_otp:
        raise SmokeTestFailed(
            "No dev_otp in /auth/otp/request response — this instance doesn't have OTP_DEV_ECHO=true. "
            "This script needs a dev-settings-like instance to auto-login without a real SMS provider "
            "(see the module docstring: it runs against the `dev` Docker target, not `prod`)."
        )
    status_code, body = client.request(
        "POST",
        "/auth/otp/verify",
        json_body={"phone": phone, "code": dev_otp, "name": "Smoke Test Vendor"},
        expect=200,
    )
    client.access_token = body["access"]

    status_code, body = client.request(
        "POST",
        "/vendors",
        json_body={
            "shop_name": shop_name,
            "category_slugs": ["vegetables"],
            "location": {
                "lat": 28.4598,
                "lng": 77.0270,
                "address_line": "Smoke Test Market",
                "city": "Gurugram",
            },
        },
        expect=201,
    )
    return body


def upload_image(client: Client, path: Path) -> str:
    _, body = client.multipart_upload("/media", "file", path.name, path.read_bytes(), expect=201)
    if body.get("kind") != "image":
        raise SmokeTestFailed(f"Uploaded fixture wasn't recognised as an image: {body}")
    return body["id"]


def run(base_url: str) -> None:
    step("1. API is reachable (GET /health)")
    health_url = _health_url(base_url)
    req = urllib.request.Request(health_url)  # noqa: S310 (derived from the operator-supplied --base-url)
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
        if resp.status != 200:
            raise SmokeTestFailed(f"GET /health -> {resp.status}")
    ok("API is up")

    client = Client(base_url)

    step("6. Authenticated vendor can sign up and submit an image (real phone+OTP, real shop)")
    vendor = signup_vendor(client, f"Smoke Test Store {uuid.uuid4().hex[:6]}")
    ok(f"vendor created: {vendor['handle']}")

    # ---- OCR path (steps 3, 5, 7, 8) ----
    step("5/7. POST /ai/detections with a real OCR-legible label image")
    image_id = upload_image(client, LABEL_IMAGE)
    _, detection = client.request("POST", "/ai/detections", json_body={"image_id": image_id}, expect=201)
    if detection["status"] != "done":
        raise SmokeTestFailed(
            f"OCR detection did not complete (status={detection['status']!r}, error={detection.get('error')!r}) "
            "— this usually means tesseract is not actually installed/callable inside this image."
        )
    ok("detection completed (status=done)")

    step("3. tesseract is actually callable inside this image (real extracted OCR text)")
    if "TAMATAR" not in detection.get("ocr_text", "").upper():
        raise SmokeTestFailed(f"Expected real OCR text containing 'TAMATAR', got: {detection.get('ocr_text')!r}")
    ok(f"real OCR text extracted: {detection['ocr_text']!r}")

    step("8. OCR result reaches the taxonomy/product matching layer")
    predictions = detection.get("predictions") or []
    tomato_pred = next((p for p in predictions if p.get("product_slug") == "tomato"), None)
    if tomato_pred is None:
        raise SmokeTestFailed(f"Expected a 'tomato' prediction from taxonomy matching, got: {predictions}")
    ok(f"matched to real taxonomy entry: {tomato_pred['product_name']} (confidence={tomato_pred['confidence']:.2f})")

    step("9. Vendor confirmation creates the normal VendorConnect product/listing")
    _, listing = client.request(
        "POST",
        f"/ai/detections/{detection['id']}/confirm",
        json_body={
            "category": "vegetables",
            "product": "tomato",
            "name": "Tomato",
            "price": "30.00",
            "unit": "kg",
        },
        expect=201,
    )
    if listing.get("source") != "ai":
        raise SmokeTestFailed(f"Confirmed listing should have source='ai', got: {listing.get('source')!r}")
    ok(f"real VendorProduct created: id={listing['id']} source={listing['source']}")

    _, my_products = client.request("GET", "/vendor-products", expect=200)
    if not any(p["id"] == listing["id"] for p in my_products["results"]):
        raise SmokeTestFailed("Confirmed listing does not appear in GET /vendor-products — not really persisted.")
    ok("listing round-trips through the real product list, exactly like a manual Add Product")

    # ---- Barcode path (steps 4, 7 again, for the barcode-specific route) ----
    step("4/7. POST /ai/detections with a real, genuinely scannable barcode image")
    barcode_image_id = upload_image(client, BARCODE_IMAGE)
    _, barcode_detection = client.request(
        "POST", "/ai/detections", json_body={"image_id": barcode_image_id}, expect=201
    )
    if barcode_detection["status"] != "done":
        raise SmokeTestFailed(
            f"Barcode detection did not complete (status={barcode_detection['status']!r}, "
            f"error={barcode_detection.get('error')!r}) — this usually means libzbar is not actually "
            "installed/loadable inside this image."
        )
    if barcode_detection.get("barcode") != EXPECTED_BARCODE:
        raise SmokeTestFailed(
            f"Expected real decoded barcode {EXPECTED_BARCODE!r}, got: {barcode_detection.get('barcode')!r}. "
            "If this is empty, either libzbar isn't installed in this image, or the seeded 'tomato' "
            f"product hasn't been given barcode={EXPECTED_BARCODE!r} yet — see this script's module "
            "docstring for the one-time setup step."
        )
    ok(f"pyzbar/zbar decoded the real barcode: {barcode_detection['barcode']}")
    barcode_pred = next((p for p in barcode_detection.get("predictions") or [] if p.get("source") == "barcode"), None)
    if barcode_pred is None or barcode_pred.get("product_slug") != "tomato":
        raise SmokeTestFailed(
            f"Expected a barcode-sourced 'tomato' prediction, got: {barcode_detection.get('predictions')}"
        )
    ok(f"barcode matched to real catalog entry: {barcode_pred['product_name']}")

    # ---- Authorization (step 10) ----
    step("10. A second vendor can never see or confirm the first vendor's detection")
    other_client = Client(base_url)
    signup_vendor(other_client, f"Smoke Test Intruder {uuid.uuid4().hex[:6]}")
    status_code, _ = other_client.request("GET", f"/ai/detections/{detection['id']}", expect=None)
    if status_code != 404:
        raise SmokeTestFailed(
            f"Second vendor could see the first vendor's detection (status={status_code}, expected 404)"
        )
    status_code, _ = other_client.request(
        "POST",
        f"/ai/detections/{detection['id']}/confirm",
        json_body={"category": "vegetables", "name": "Should not work", "price": "1", "unit": "kg"},
        expect=None,
    )
    if status_code != 404:
        raise SmokeTestFailed(
            f"Second vendor could confirm the first vendor's detection (status={status_code}, expected 404)"
        )
    ok("cross-vendor access correctly denied (404 on both GET and confirm)")

    print("\nAll Phase 10 AI runtime smoke test checks passed against a real running instance.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--base-url", default="http://localhost:8000/api/v1", help="API base URL (default: %(default)s)"
    )
    parser.add_argument(
        "--wait-seconds", type=int, default=0, help="Retry /health for up to this many seconds before starting"
    )
    args = parser.parse_args()

    if args.wait_seconds:
        deadline = time.time() + args.wait_seconds
        health_url = _health_url(args.base_url)
        while True:
            try:
                with urllib.request.urlopen(health_url, timeout=5) as resp:  # noqa: S310 (operator-supplied --base-url)
                    if resp.status == 200:
                        break
            except (urllib.error.URLError, TimeoutError):
                pass
            if time.time() > deadline:
                print(f"Timed out waiting for {health_url} to become healthy", file=sys.stderr)
                return 1
            time.sleep(1)

    try:
        run(args.base_url)
    except SmokeTestFailed as exc:
        print(f"\nSMOKE TEST FAILED: {exc}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"\nCould not reach {args.base_url}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
