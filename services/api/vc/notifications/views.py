from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from vc.core.pagination import StandardPagination

from .models import Notification
from .serializers import NotificationSerializer


class NotificationCollectionView(APIView):
    """GET /notifications — real events written by order (Phase 8) and future chat/review triggers,
    replacing the "coming soon" placeholder both NotificationsScreens have shown since Phase 1."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[OpenApiParameter("page", int, required=False), OpenApiParameter("page_size", int, required=False)],
        responses=NotificationSerializer(many=True),
    )
    def get(self, request):
        qs = request.user.notifications.order_by("-created_at")
        paginator: PageNumberPagination = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        response = paginator.get_paginated_response(NotificationSerializer(page, many=True).data)
        response.data["unread_count"] = request.user.notifications.filter(read_at__isnull=True).count()
        return response


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, notification_id):
        # Cross-account safety: scoped to the caller's own notifications (master-prompt §68).
        n = get_object_or_404(Notification, id=notification_id, user=request.user)
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=["read_at", "updated_at"])
        return Response(status=204)


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        request.user.notifications.filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=204)
