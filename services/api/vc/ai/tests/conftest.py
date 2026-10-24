"""Shared fixtures for Phase 10 (AI product detection) tests."""

import io

import barcode as barcode_lib
import pytest
from barcode.writer import ImageWriter
from PIL import Image, ImageDraw, ImageFont

from vc.orders.tests.conftest import listing, open_vendor  # noqa: F401 (reused fixtures)

MEDIA = "/api/v1/media"
DETECTIONS = "/api/v1/ai/detections"

_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _font(size=48):
    try:
        return ImageFont.truetype(_FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def label_image_bytes(text: str) -> bytes:
    """A real, legible label image — genuinely OCR'd by tesseract in these tests, not stubbed."""
    img = Image.new("RGB", (700, 160), "white")
    ImageDraw.Draw(img).text((20, 50), text, fill="black", font=_font())
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def barcode_image_bytes(digits: str = "400638133393") -> bytes:
    """A real, genuinely scannable EAN-13 barcode image (12 digits in, check digit computed by the
    encoder — see the returned value's last digit)."""
    code = barcode_lib.get("ean13", digits, writer=ImageWriter())
    buf = io.BytesIO()
    code.write(buf)
    return buf.getvalue()


def blank_image_bytes() -> bytes:
    """No barcode, no text — the genuinely-common "loose produce, no label" case this provider is
    honest about not being able to identify."""
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), "white").save(buf, format="PNG")
    return buf.getvalue()


def upload_bytes(client, data: bytes, *, filename: str = "scan.png", content_type: str | None = None) -> str:
    f = io.BytesIO(data)
    f.name = filename
    r = client.post(MEDIA, {"file": f}, format="multipart")
    assert r.status_code == 201, r.content
    return r.json()["id"]


@pytest.fixture
def tomato_listing(vendor_client):
    """Unlike the shared `listing` fixture (a custom, catalog-unlinked item), this one is actually
    linked to the seeded 'tomato' `Product` — needed to exercise "you already list this" (master
    prompt §12)."""
    r = vendor_client.post(
        "/api/v1/vendor-products",
        {"category": "vegetables", "product": "tomato", "name": "Tomato", "price": "30", "unit": "kg"},
        format="json",
    )
    assert r.status_code == 201, r.content
    return r.json()


@pytest.fixture
def barcoded_tomato(db):
    """Gives the seeded 'tomato' product a real barcode for the duration of the test, and restores
    it afterwards — other tests/fixtures assume the seeded catalog is barcode-less."""
    from vc.catalog.models import Product

    product = Product.objects.get(slug="tomato")
    product.barcode = "4006381333931"
    product.save(update_fields=["barcode"])
    yield product
    product.barcode = ""
    product.save(update_fields=["barcode"])
