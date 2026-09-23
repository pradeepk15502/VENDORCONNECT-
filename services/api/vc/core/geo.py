from decimal import ROUND_HALF_UP, Decimal

from django.contrib.gis.geos import Point
from rest_framework import serializers

INDIA_BOUNDS = {"lat": (6.0, 37.5), "lng": (68.0, 97.5)}


def coarse(value: float, places: int = 3) -> float:
    """Round a coordinate to ~110 m for logging/analytics (privacy, ARCHITECTURE D11)."""
    q = Decimal(1).scaleb(-places)
    return float(Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP))


def make_point(lat: float, lng: float) -> Point:
    return Point(float(lng), float(lat), srid=4326)


class LatLngField(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
