import pytest

from vc.vendors.handles import handle_prefix, looks_like_handle, normalize_handle


@pytest.mark.parametrize(
    "name,prefix",
    [
        ("Sharma Vegetable Store", "SHARMA"),
        ("AB Stores", "ABSTORES"),
        ("Shri Balaji Kirana", "SHRI"),
        ("श्री राम किराना", "SHOP"),
        ("Admin Store", "ADMINSHO"),
        ("Supercalifragilistic Mart", "SUPERCAL"),
        ("  gupta's   ", "GUPTAS"),
    ],
)
def test_prefix(name, prefix):
    assert handle_prefix(name) == prefix


def test_normalize_and_detect():
    assert normalize_handle(" @sharma001 ") == "SHARMA001"
    assert looks_like_handle("@Sharma001") and not looks_like_handle("tomato")
