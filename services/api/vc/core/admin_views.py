from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsStaffRole


class AdminWhoAmIView(APIView):
    """Used by the admin web app to confirm an admin-grade session (password + OTP)."""

    permission_classes = [IsStaffRole]

    @extend_schema(
        responses=inline_serializer(
            "AdminWhoAmI",
            {
                "id": serializers.UUIDField(),
                "name": serializers.CharField(),
                "roles": serializers.ListField(child=serializers.CharField()),
                "permissions": serializers.ListField(child=serializers.CharField()),
            },
        )
    )
    def get(self, request):
        u = request.user
        return Response(
            {
                "id": str(u.id),
                "name": u.name,
                "roles": sorted(u.role_codes()),
                "permissions": sorted(u.get_all_permissions()) if not u.is_superuser else ["*"],
            }
        )
