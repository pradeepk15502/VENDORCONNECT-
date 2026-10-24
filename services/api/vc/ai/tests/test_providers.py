"""Unit-level tests for the detection provider itself — no HTTP, no vendor/auth plumbing. These
exist alongside the end-to-end tests in test_detect.py so the confidence-band boundaries are
pinned exactly, independent of any particular OCR/barcode image's real-world fuzziness."""

import pytest

from vc.ai.providers import BAND_LIKELY, BAND_NONE, BAND_POSSIBLE, LocalDetectionProvider, confidence_band

from .conftest import barcode_image_bytes, blank_image_bytes

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    "confidence,expected",
    [
        (0.0, BAND_NONE),
        (0.39, BAND_NONE),
        (0.4, BAND_POSSIBLE),
        (0.59, BAND_POSSIBLE),
        (0.6, BAND_LIKELY),
        (1.0, BAND_LIKELY),
    ],
)
def test_confidence_band_boundaries(confidence, expected):
    assert confidence_band(confidence) == expected


def test_provider_never_claims_to_be_production():
    provider = LocalDetectionProvider()
    assert provider.is_development is True
    assert provider.name and provider.version


def test_garbage_bytes_fail_cleanly_instead_of_crashing():
    result = LocalDetectionProvider().detect(b"this is not an image at all")
    assert result.error == "unreadable_image"
    assert result.predictions == []


def test_barcode_with_no_catalog_match_reports_the_code_with_no_prediction():
    """A real, decodable barcode that simply isn't in the (currently barcode-less) seeded catalog —
    honestly reported as "we read this code" without inventing a product for it."""
    result = LocalDetectionProvider().detect(barcode_image_bytes("999999999999"))
    assert result.barcode  # a real code was decoded
    assert result.predictions == []


def test_blank_image_has_no_barcode_and_no_text():
    result = LocalDetectionProvider().detect(blank_image_bytes())
    assert result.barcode == ""
    assert result.ocr_text == ""
    assert result.predictions == []
