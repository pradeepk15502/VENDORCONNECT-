import re

_IN_MOBILE = re.compile(r"^[6-9]\d{9}$")


class InvalidPhone(ValueError):
    pass


def normalize_phone(raw: str) -> str:
    """Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX). MVP supports India only."""
    if raw is None:
        raise InvalidPhone("Phone number is required.")
    digits = re.sub(r"[\s\-()]", "", str(raw))
    if digits.startswith("+91"):
        digits = digits[3:]
    elif digits.startswith("0091"):
        digits = digits[4:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not _IN_MOBILE.match(digits):
        raise InvalidPhone("Enter a valid 10-digit mobile number.")
    return "+91" + digits
