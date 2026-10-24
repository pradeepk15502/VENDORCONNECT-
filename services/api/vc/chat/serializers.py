from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import QuickReply


class _ChatVendorSerializer(serializers.Serializer):
    """What a customer sees about the other side of their own chat. `public_phone` is included so
    the chat screen can offer the same Call button as the vendor's profile (ARCHITECTURE D14:
    vendor numbers are shown to customers; the reverse is never true — see _ChatCustomerSerializer)."""

    handle = serializers.CharField()
    vendor_id = serializers.CharField(source="display_handle")
    shop_name = serializers.CharField()
    is_open = serializers.BooleanField()
    public_phone = serializers.CharField()


class _ChatCustomerSerializer(serializers.Serializer):
    """What a vendor sees about the other side — name only, never the phone number.
    ARCHITECTURE D14: vendor numbers are shown to customers (the Call button); customer numbers
    are never shown to vendors."""

    id = serializers.UUIDField()
    name = serializers.CharField()


class _LastMessagePreviewSerializer(serializers.Serializer):
    """Documentation-only shape of `get_last_message`'s dict — it is built from four separate
    `last_message_*` annotations/attributes, never from a real `Message` instance."""

    text = serializers.CharField()
    kind = serializers.CharField()
    sender_side = serializers.CharField()
    created_at = serializers.DateTimeField()


class ChatSerializer(serializers.Serializer):
    """One row of `GET /chats` — built with `context={"role": "customer"|"vendor"}` so the same
    conversation renders correctly from either side."""

    id = serializers.UUIDField()
    other = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.IntegerField()
    blocked_by_me = serializers.SerializerMethodField()
    blocked_by_them = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()

    @extend_schema_field(serializers.DictField(help_text="_ChatVendorSerializer or _ChatCustomerSerializer, by role"))
    def get_other(self, chat):
        if self.context["role"] == "customer":
            return _ChatVendorSerializer(chat.vendor).data
        return _ChatCustomerSerializer(chat.customer).data

    @extend_schema_field(_LastMessagePreviewSerializer(allow_null=True))
    def get_last_message(self, chat):
        """Built from the four `last_message_*` annotations (list view) or attributes
        (`_attach_summary`, detail view) — never a single `last_message` object, since one was
        never annotated under that name."""
        if chat.last_message_created_at is None:
            return None
        return {
            "text": chat.last_message_text,
            "kind": chat.last_message_kind,
            "sender_side": chat.last_message_sender_side,
            "created_at": chat.last_message_created_at,
        }

    def get_blocked_by_me(self, chat) -> bool:
        return chat.blocked_by_customer if self.context["role"] == "customer" else chat.blocked_by_vendor

    def get_blocked_by_them(self, chat) -> bool:
        return chat.blocked_by_vendor if self.context["role"] == "customer" else chat.blocked_by_customer


class ChatListQuerySerializer(serializers.Serializer):
    """`role` (not `as` — a reserved word) says which side of a chat to list: the caller's own
    conversations as a customer, or as a vendor. A user can be both, so this can't be inferred."""

    role = serializers.ChoiceField(choices=["customer", "vendor"])
    q = serializers.CharField(required=False, allow_blank=True, default="")
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    page_size = serializers.IntegerField(required=False, min_value=1, max_value=100, default=20)


class ChatStartSerializer(serializers.Serializer):
    """POST /chats — a customer starting (or reopening) a conversation with a vendor."""

    vendor = serializers.CharField()


class _MessageListingSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    unit = serializers.CharField()


class MessageSerializer(serializers.Serializer):
    """`public_id` is the message's real identity; the numeric row id is only ever exposed as an
    opaque `cursor` for polling/pagination, never labelled as the message's id."""

    id = serializers.UUIDField(source="public_id")
    cursor = serializers.IntegerField(source="id")
    sender_side = serializers.CharField()
    kind = serializers.CharField()
    text = serializers.CharField()
    listing = _MessageListingSerializer(allow_null=True)
    created_at = serializers.DateTimeField()


class MessageCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["text", "product"], default="text")
    text = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    listing_id = serializers.UUIDField(required=False)
    client_message_id = serializers.CharField(required=False, allow_blank=True, max_length=64, default="")

    def validate(self, attrs):
        if attrs["kind"] == "text" and not attrs.get("text", "").strip():
            raise serializers.ValidationError({"text": "This field may not be blank."})
        if attrs["kind"] == "product" and not attrs.get("listing_id"):
            raise serializers.ValidationError({"listing_id": "Required when kind is 'product'."})
        return attrs


class ReportChatSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=["spam", "wrong_info", "abusive", "fraud", "other"])
    details = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class QuickReplySerializer(serializers.ModelSerializer):
    class Meta:
        model = QuickReply
        fields = ["id", "text", "position"]
        read_only_fields = ["id", "position"]


class QuickReplyCreateSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=200)
