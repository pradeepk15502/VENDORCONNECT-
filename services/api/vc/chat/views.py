import uuid

from django.core.exceptions import PermissionDenied
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from vc.audit import service as audit
from vc.catalog.models import VendorProduct
from vc.core.exceptions import DomainError
from vc.core.pagination import StandardPagination
from vc.core.permissions import IsVendor
from vc.core.throttles import ReportSubmitThrottle
from vc.moderation.models import Report
from vc.vendors.handles import normalize_handle
from vc.vendors.models import Vendor
from vc.vendors.views import my_vendor

from .models import Chat, Message, QuickReply
from .serializers import (
    ChatListQuerySerializer,
    ChatSerializer,
    ChatStartSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    QuickReplyCreateSerializer,
    QuickReplySerializer,
    ReportChatSerializer,
)

QUICK_REPLY_LIMIT = 20


class ChatMessageThrottle(UserRateThrottle):
    """Phase 12 hardening: ownership checks (`_get_chat`) only establish that the sender is
    legitimately one of the two chat participants — they don't limit *volume* between two already-
    legitimate parties, so nothing stopped one side from flooding the other beyond the generic
    `user` budget (sized for cheap CRUD, not messaging). The victim can `block`, but only after
    being flooded."""

    scope = "chat_message"


# --- Chat lookup / role resolution ------------------------------------------------------------


def _get_chat(chat_id, user) -> tuple[Chat, str]:
    """A user is on one side of a chat only, never both — resolve which, or 403.
    (master-prompt §68: no cross-account access, ever, regardless of what's guessed in a URL.)"""
    chat = get_object_or_404(
        Chat.objects.select_related("vendor", "vendor__location", "vendor__delivery", "customer"), id=chat_id
    )
    if chat.customer_id == user.id:
        return chat, "customer"
    if chat.vendor.owner_id == user.id:
        return chat, "vendor"
    raise PermissionDenied("You are not part of this conversation.")


def _attach_summary(chat: Chat, role: str) -> Chat:
    """Single-chat equivalent of the list endpoint's annotations (2 small queries — fine for one row)."""
    last = chat.messages.order_by("-id").first()
    chat.last_message_text = last.text if last else None
    chat.last_message_kind = last.kind if last else None
    chat.last_message_sender_side = last.sender_side if last else None
    chat.last_message_created_at = last.created_at if last else None
    other_side = "vendor" if role == "customer" else "customer"
    last_read = chat.customer_last_read_at if role == "customer" else chat.vendor_last_read_at
    unread_qs = chat.messages.filter(sender_side=other_side)
    if last_read is not None:
        unread_qs = unread_qs.filter(created_at__gt=last_read)
    chat.unread_count = unread_qs.count()
    return chat


def _blocked_for_sender(chat: Chat, role: str) -> bool:
    """Is `role` currently prevented from sending, because the *other* side blocked them?"""
    return chat.blocked_by_vendor if role == "customer" else chat.blocked_by_customer


# --- Conversation list + start -----------------------------------------------------------------


class ChatCollectionView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("role", str, enum=["customer", "vendor"], required=True),
            OpenApiParameter("q", str, required=False, description="Filter by the other side's name/shop name"),
        ],
        responses=ChatSerializer(many=True),
    )
    def get(self, request):
        v = ChatListQuerySerializer(data=request.query_params)
        v.is_valid(raise_exception=True)
        role = v.validated_data["role"]

        if role == "customer":
            qs = Chat.objects.filter(customer=request.user).select_related("vendor", "vendor__location")
            if v.validated_data["q"]:
                qs = qs.filter(vendor__shop_name__icontains=v.validated_data["q"])
            last_read_field = "customer_last_read_at"
            other_side = "vendor"
        else:
            vendor = my_vendor(request.user)
            qs = Chat.objects.filter(vendor=vendor).select_related("customer")
            if v.validated_data["q"]:
                # Name only — never let a vendor search customers by phone digits (D14: customer
                # phone numbers are never exposed to vendors, so they must not be guessable either).
                qs = qs.filter(customer__name__icontains=v.validated_data["q"])
            last_read_field = "vendor_last_read_at"
            other_side = "customer"

        last_msg_qs = Message.objects.filter(chat=OuterRef("pk")).order_by("-id")
        unread_q = Q(messages__sender_side=other_side) & (
            Q(**{f"{last_read_field}__isnull": True}) | Q(messages__created_at__gt=F(last_read_field))
        )
        qs = qs.annotate(
            last_message_text=Subquery(last_msg_qs.values("text")[:1]),
            last_message_kind=Subquery(last_msg_qs.values("kind")[:1]),
            last_message_sender_side=Subquery(last_msg_qs.values("sender_side")[:1]),
            last_message_created_at=Subquery(last_msg_qs.values("created_at")[:1]),
            unread_count=Count("messages", filter=unread_q, distinct=True),
        ).order_by(F("last_message_at").desc(nulls_last=True), "-created_at")

        paginator = StandardPagination()
        paginator.request = request
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ChatSerializer(page, many=True, context={"role": role}).data)

    @extend_schema(request=ChatStartSerializer, responses={200: ChatSerializer, 201: ChatSerializer})
    def post(self, request):
        """Customer-only: get-or-create the chat with a vendor (D14: the customer always starts it)."""
        v = ChatStartSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        handle = normalize_handle(v.validated_data["vendor"])
        vendor = get_object_or_404(Vendor.objects.filter(status=Vendor.STATUS_ACTIVE), handle=handle)
        if vendor.owner_id == request.user.id:
            raise DomainError("You can't message your own shop.", code="cannot_chat_own_shop")
        chat, created = Chat.objects.get_or_create(customer=request.user, vendor=vendor)
        _attach_summary(chat, "customer")
        return Response(
            ChatSerializer(chat, context={"role": "customer"}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ChatDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ChatSerializer)
    def get(self, request, chat_id):
        chat, role = _get_chat(chat_id, request.user)
        _attach_summary(chat, role)
        return Response(ChatSerializer(chat, context={"role": role}).data)


# --- Messages ------------------------------------------------------------------------------------


class ChatMessagesView(APIView):
    permission_classes = [IsAuthenticated]
    PAGE_SIZE = 30
    POLL_LIMIT = 200

    def get_throttles(self):
        # Only sending is rate-limited (ChatMessageThrottle) — polling for new messages (GET) stays
        # under the generic per-user budget so an active conversation doesn't feel throttled while
        # reading it.
        if self.request.method == "POST":
            return [ChatMessageThrottle()]
        return super().get_throttles()

    @extend_schema(
        parameters=[
            OpenApiParameter("before", int, required=False, description="Load messages older than this cursor"),
            OpenApiParameter("after", int, required=False, description="Poll for messages newer than this cursor"),
        ],
        responses=inline_serializer(
            "ChatMessagePage", {"results": MessageSerializer(many=True), "has_more": serializers.BooleanField()}
        ),
    )
    def get(self, request, chat_id):
        chat, _role = _get_chat(chat_id, request.user)
        after = request.query_params.get("after")
        before = request.query_params.get("before")

        # Phase 12 hardening (docs/ARCHITECTURE.md D33): MessageSerializer.listing reads
        # message.listing.{id,name,price,unit} for every "product" message — without select_related
        # that's one query per product message in the page, not one for the whole page.
        if after:
            rows = list(
                chat.messages.select_related("listing").filter(id__gt=int(after)).order_by("id")[: self.POLL_LIMIT]
            )
            has_more = False
        else:
            qs = chat.messages.select_related("listing").order_by("-id")
            if before:
                qs = qs.filter(id__lt=int(before))
            page = list(qs[: self.PAGE_SIZE + 1])
            has_more = len(page) > self.PAGE_SIZE
            rows = list(reversed(page[: self.PAGE_SIZE]))

        return Response({"results": MessageSerializer(rows, many=True).data, "has_more": has_more})

    @extend_schema(request=MessageCreateSerializer, responses={200: MessageSerializer, 201: MessageSerializer})
    def post(self, request, chat_id):
        chat, role = _get_chat(chat_id, request.user)
        if _blocked_for_sender(chat, role):
            raise DomainError("This conversation is no longer accepting messages.", code="blocked", status_code=403)

        v = MessageCreateSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        data = v.validated_data

        client_message_id = data.get("client_message_id") or ""
        if client_message_id:
            existing = chat.messages.filter(client_message_id=client_message_id).first()
            if existing:
                return Response(MessageSerializer(existing).data, status=status.HTTP_200_OK)

        listing = None
        text = ""
        if data["kind"] == "product":
            listing = get_object_or_404(
                VendorProduct.objects.filter(vendor=chat.vendor, status=VendorProduct.STATUS_ACTIVE),
                id=data["listing_id"],
            )
        else:
            text = data["text"].strip()

        message = Message.objects.create(
            public_id=uuid.uuid4(),
            chat=chat,
            sender=request.user,
            sender_side=role,
            kind=data["kind"],
            text=text,
            listing=listing,
            client_message_id=client_message_id,
        )
        Chat.objects.filter(id=chat.id).update(last_message_at=message.created_at)
        return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)


class ChatReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, chat_id):
        chat, role = _get_chat(chat_id, request.user)
        field = "customer_last_read_at" if role == "customer" else "vendor_last_read_at"
        Chat.objects.filter(id=chat.id).update(**{field: timezone.now()})
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatBlockView(APIView):
    """Registered twice in urls.py — once with `blocked_value=True` (`/block`), once with
    `blocked_value=False` (`/unblock`) — the standard Django `as_view(**initkwargs)` pattern."""

    permission_classes = [IsAuthenticated]
    blocked_value: bool = True

    @extend_schema(request=None, responses={204: None})
    def post(self, request, chat_id):
        chat, role = _get_chat(chat_id, request.user)
        field = "blocked_by_customer" if role == "customer" else "blocked_by_vendor"
        Chat.objects.filter(id=chat.id).update(**{field: self.blocked_value})
        audit.record(
            "chat.blocked" if self.blocked_value else "chat.unblocked", request=request, target=chat, role=role
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatReportView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ReportSubmitThrottle]

    @extend_schema(
        request=ReportChatSerializer, responses=inline_serializer("ChatReportAck", {"status": serializers.CharField()})
    )
    def post(self, request, chat_id):
        chat, role = _get_chat(chat_id, request.user)
        v = ReportChatSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        if role == "customer":
            target_type, target_id = "vendor", chat.vendor_id
        else:
            target_type, target_id = "user", chat.customer_id
        Report.objects.create(
            reporter=request.user,
            target_type=target_type,
            target_id=target_id,
            reason=v.validated_data["reason"],
            details=v.validated_data["details"],
        )
        audit.record("chat.reported", request=request, target=chat, role=role, reason=v.validated_data["reason"])
        return Response({"status": "received"}, status=status.HTTP_201_CREATED)


# --- Vendor quick replies (canned responses; ARCHITECTURE D28) ---------------------------------


class QuickReplyCollectionView(APIView):
    permission_classes = [IsVendor]

    @extend_schema(responses=QuickReplySerializer(many=True))
    def get(self, request):
        vendor = my_vendor(request.user)
        replies = vendor.quick_replies.order_by("position")
        return Response(QuickReplySerializer(replies, many=True).data)

    @extend_schema(request=QuickReplyCreateSerializer, responses=QuickReplySerializer)
    def post(self, request):
        vendor = my_vendor(request.user)
        if vendor.quick_replies.count() >= QUICK_REPLY_LIMIT:
            raise DomainError(f"You can have at most {QUICK_REPLY_LIMIT} quick replies.", code="quick_reply_limit")
        v = QuickReplyCreateSerializer(data=request.data)
        v.is_valid(raise_exception=True)
        next_position = (vendor.quick_replies.order_by("-position").values_list("position", flat=True).first() or 0) + 1
        reply = QuickReply.objects.create(vendor=vendor, text=v.validated_data["text"], position=next_position)
        return Response(QuickReplySerializer(reply).data, status=status.HTTP_201_CREATED)


class QuickReplyDetailView(APIView):
    permission_classes = [IsVendor]

    @extend_schema(responses={204: None})
    def delete(self, request, reply_id):
        vendor = my_vendor(request.user)
        reply = get_object_or_404(QuickReply, id=reply_id, vendor=vendor)
        reply.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
