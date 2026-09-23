"""Vendor ID generation: @SHARMA001 style. See ARCHITECTURE.md D7."""

import re
import unicodedata

from django.conf import settings
from django.db import IntegrityError, transaction

from .models import Vendor

_FALLBACK = "SHOP"
RESERVED = {"ADMIN", "SUPPORT", "HELP", "VENDORCONNECT", "VC", "API", "ROOT", "SYSTEM", "OFFICIAL"}
HANDLE_RE = re.compile(r"^[A-Z]{2,8}\d{3,5}$")


def normalize_handle(raw: str) -> str:
    """'@sharma001 ' → 'SHARMA001'. Used for every lookup (case-insensitive)."""
    return (raw or "").strip().lstrip("@").upper()


def looks_like_handle(raw: str) -> bool:
    return bool(HANDLE_RE.match(normalize_handle(raw)))


def handle_prefix(shop_name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", shop_name).encode("ascii", "ignore").decode()
    words = [re.sub(r"[^A-Za-z]", "", w).upper() for w in ascii_name.split()]
    words = [w for w in words if w]
    if not words:
        return _FALLBACK
    prefix = words[0]
    i = 1
    while len(prefix) < 3 and i < len(words):  # "AB Stores" → "ABSTORES"
        prefix += words[i]
        i += 1
    prefix = prefix[: settings.VENDOR_HANDLE_MAX_LETTERS]
    if len(prefix) < 2 or prefix in RESERVED:
        prefix = (prefix + _FALLBACK)[: settings.VENDOR_HANDLE_MAX_LETTERS]
    return prefix


def next_handle(prefix: str) -> str:
    pattern = rf"^{prefix}\d{{3,5}}$"
    existing = Vendor.objects.filter(handle__iregex=pattern).values_list("handle", flat=True)
    nums = [int(h[len(prefix) :]) for h in existing]
    return f"{prefix}{(max(nums) + 1) if nums else 1:03d}"


def create_vendor_with_handle(**fields) -> Vendor:
    """Create the vendor and assign a unique handle, retrying on concurrent collisions."""
    prefix = handle_prefix(fields["shop_name"])
    last_error = None
    for _ in range(5):
        try:
            with transaction.atomic():
                vendor = Vendor(handle=next_handle(prefix), **fields)
                vendor.save()
                return vendor
        except IntegrityError as exc:  # another request took the same number
            last_error = exc
    raise last_error  # pragma: no cover
