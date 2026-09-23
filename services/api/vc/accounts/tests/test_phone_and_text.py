import pytest

from vc.accounts.phone import InvalidPhone, normalize_phone
from vc.catalog.text import normalize_text


@pytest.mark.parametrize("raw", ["9876543210", "+91 98765 43210", "09876543210", "919876543210", "+91-9876-543-210"])
def test_normalize_valid(raw):
    assert normalize_phone(raw) == "+919876543210"


@pytest.mark.parametrize("raw", ["", "12345", "5876543210", "+1 415 555 0100", "98765432101", "abcdefghij"])
def test_normalize_invalid(raw):
    with pytest.raises(InvalidPhone):
        normalize_phone(raw)


def test_text_normalisation_keeps_hindi_and_drops_nukta():
    assert normalize_text("  टमाटर ") == "टमाटर"
    assert normalize_text("प्याज़") == normalize_text("प्याज")
    assert normalize_text("Tamatar!!") == "tamatar"
