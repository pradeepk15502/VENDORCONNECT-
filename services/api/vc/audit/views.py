"""Admin audit-log viewer (Phase 11, ARCHITECTURE D32). `vc.audit.service.record()` has been
writing to `AuditLog` since Phase 1 (auth, vendor, catalog, social, moderation, ai, chat, orders all
call it already) — this is the first read endpoint over that append-only trail. Deliberately
read-only: the audit log's whole value is that nothing, including an admin, can rewrite history
through the ordinary admin API (master prompt §15: "Audit logs should be append-only from the admin
UI perspective")."""

from django.core.exceptions import ValidationError
from django.http import Http404
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.views import APIView

from vc.accounts.models import User
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsStaffRole

from .models import AuditLog
from .serializers import AuditLogSerializer

_PARAMETERS = [
    OpenApiParameter("action", str, required=False, description="Exact action code, e.g. vendor.verified"),
    OpenApiParameter("actor", str, required=False, description="Actor's phone (exact) or user id"),
    OpenApiParameter("target_type", str, required=False),
    OpenApiParameter("target_id", str, required=False),
    OpenApiParameter("date_from", str, required=False, description="ISO 8601 datetime, inclusive"),
    OpenApiParameter("date_to", str, required=False, description="ISO 8601 datetime, inclusive"),
    OpenApiParameter("page", int, required=False),
    OpenApiParameter("page_size", int, required=False),
]


class AdminAuditLogListView(APIView):
    permission_classes = [IsStaffRole]

    @extend_schema(parameters=_PARAMETERS, responses=AuditLogSerializer(many=True))
    def get(self, request):
        qs = AuditLog.objects.select_related("actor").order_by("-created_at")
        q = request.query_params
        if q.get("action"):
            qs = qs.filter(action=q["action"])
        if q.get("target_type"):
            qs = qs.filter(target_type=q["target_type"])
        if q.get("target_id"):
            qs = qs.filter(target_id=q["target_id"])
        if q.get("actor"):
            actor = User.objects.filter(phone=q["actor"]).first()
            if actor is None:
                try:
                    actor = User.objects.get(id=q["actor"])
                except (User.DoesNotExist, ValueError, ValidationError) as exc:
                    raise Http404("No such actor.") from exc
            qs = qs.filter(actor=actor)
        if q.get("date_from"):
            dt = parse_datetime(q["date_from"])
            if dt is not None:
                qs = qs.filter(created_at__gte=dt)
        if q.get("date_to"):
            dt = parse_datetime(q["date_to"])
            if dt is not None:
                qs = qs.filter(created_at__lte=dt)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(AuditLogSerializer(page, many=True).data)
