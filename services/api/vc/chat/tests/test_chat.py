import pytest
from rest_framework.test import APIClient

from conftest import login
from vc.audit.models import AuditLog
from vc.chat.models import Chat, Message, QuickReply
from vc.moderation.models import Report
from vc.vendors.models import Vendor

pytestmark = pytest.mark.django_db

CHATS = "/api/v1/chats"


def vendor_handle(vendor_client) -> str:
    return vendor_client.get("/api/v1/vendors/me").json()["handle"]


def start_chat(customer_client, handle) -> str:
    r = customer_client.post(CHATS, {"vendor": handle}, format="json")
    assert r.status_code == 201, r.content
    return r.json()["id"]


# --- Starting a conversation ---------------------------------------------------------------------


def test_customer_starts_a_chat_with_a_vendor(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    r = api.post(CHATS, {"vendor": handle}, format="json")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["other"] == {
        "handle": handle,
        "vendor_id": f"@{handle}",
        "shop_name": "Sharma Vegetable Store",
        "is_open": False,
        "public_phone": "+919123456780",
    }
    assert body["last_message"] is None and body["unread_count"] == 0


def test_starting_the_same_chat_twice_is_idempotent(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    first = api.post(CHATS, {"vendor": handle}, format="json").json()["id"]
    r2 = api.post(CHATS, {"vendor": handle}, format="json")
    assert r2.status_code == 200
    assert r2.json()["id"] == first
    assert Chat.objects.count() == 1


def test_vendor_cannot_message_their_own_shop(vendor_client):
    handle = vendor_handle(vendor_client)
    r = vendor_client.post(CHATS, {"vendor": handle}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "cannot_chat_own_shop"


def test_starting_a_chat_with_an_unknown_handle_is_404(api, customer):
    r = api.post(CHATS, {"vendor": "NOSUCH001"}, format="json")
    assert r.status_code == 404


def test_starting_a_chat_requires_authentication():
    assert APIClient().post(CHATS, {"vendor": "SHARMA001"}, format="json").status_code == 401


# --- Messaging -------------------------------------------------------------------------------


def test_text_message_round_trip_both_sides_see_it(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))

    r = api.post(f"{CHATS}/{chat_id}/messages", {"text": "Do you have 5 kg potato?"}, format="json")
    assert r.status_code == 201, r.content
    msg = r.json()
    assert msg["sender_side"] == "customer" and msg["kind"] == "text" and msg["text"] == "Do you have 5 kg potato?"
    assert msg["listing"] is None

    seen_by_vendor = vendor_client.get(f"{CHATS}/{chat_id}/messages").json()["results"]
    assert len(seen_by_vendor) == 1 and seen_by_vendor[0]["text"] == "Do you have 5 kg potato?"


def test_vendor_reply_and_customer_polls_for_it_with_after_cursor(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    first = api.post(f"{CHATS}/{chat_id}/messages", {"text": "Potato available?"}, format="json").json()

    reply = vendor_client.post(f"{CHATS}/{chat_id}/messages", {"text": "Yes, ₹25/kg"}, format="json")
    assert reply.status_code == 201 and reply.json()["sender_side"] == "vendor"

    polled = api.get(f"{CHATS}/{chat_id}/messages", {"after": first["cursor"]}).json()
    assert [m["text"] for m in polled["results"]] == ["Yes, ₹25/kg"]


def test_blank_text_message_is_rejected(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    r = api.post(f"{CHATS}/{chat_id}/messages", {"text": "   "}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"


def test_message_pagination_before_cursor_loads_older_history(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    for i in range(35):
        api.post(f"{CHATS}/{chat_id}/messages", {"text": f"msg {i}"}, format="json")

    first_page = api.get(f"{CHATS}/{chat_id}/messages").json()
    assert len(first_page["results"]) == 30 and first_page["has_more"] is True
    assert first_page["results"][0]["text"] == "msg 5"  # oldest of the most-recent 30
    assert first_page["results"][-1]["text"] == "msg 34"

    older = api.get(f"{CHATS}/{chat_id}/messages", {"before": first_page["results"][0]["cursor"]}).json()
    assert len(older["results"]) == 5 and older["has_more"] is False
    assert [m["text"] for m in older["results"]] == [f"msg {i}" for i in range(5)]


def test_product_share_message_carries_real_listing_data(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    listing = vendor_client.post(
        "/api/v1/vendor-products",
        {"category": "vegetables", "name": "Tomato", "price": "30", "unit": "kg"},
        format="json",
    ).json()
    chat_id = start_chat(api, handle)

    r = api.post(f"{CHATS}/{chat_id}/messages", {"kind": "product", "listing_id": listing["id"]}, format="json")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["kind"] == "product" and body["listing"] == {
        "id": listing["id"],
        "name": "Tomato",
        "price": "30.00",
        "unit": "kg",
    }


def test_product_share_rejects_a_listing_from_a_different_vendor(api, customer, vendor_client):
    other = APIClient()
    login(other, "9123456781", "Suresh Kumar")
    other.post(
        "/api/v1/vendors",
        {
            "shop_name": "Suresh Kirana Store",
            "category_slugs": ["grocery"],
            "location": {"lat": 28.47, "lng": 77.03, "address_line": "Shop 2", "city": "Gurugram", "pincode": "122001"},
        },
        format="json",
    )
    foreign_listing = other.post(
        "/api/v1/vendor-products", {"category": "grocery", "name": "Rice", "price": "60", "unit": "kg"}, format="json"
    ).json()

    chat_id = start_chat(api, vendor_handle(vendor_client))
    r = api.post(f"{CHATS}/{chat_id}/messages", {"kind": "product", "listing_id": foreign_listing["id"]}, format="json")
    assert r.status_code == 404


def test_client_message_id_retry_does_not_duplicate(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    body = {"text": "hello", "client_message_id": "retry-1"}
    first = api.post(f"{CHATS}/{chat_id}/messages", body, format="json")
    second = api.post(f"{CHATS}/{chat_id}/messages", body, format="json")
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert Message.objects.filter(chat_id=chat_id).count() == 1


# --- Read state / unread counts ---------------------------------------------------------------


def test_unread_count_and_marking_read(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    vendor_client.post(f"{CHATS}/{chat_id}/messages", {"text": "hi"}, format="json")
    vendor_client.post(f"{CHATS}/{chat_id}/messages", {"text": "there"}, format="json")

    mine = api.get(CHATS, {"role": "customer"}).json()["results"][0]
    assert mine["unread_count"] == 2
    assert mine["last_message"] == {
        "text": "there",
        "kind": "text",
        "sender_side": "vendor",
        "created_at": mine["last_message"]["created_at"],
    }

    assert api.post(f"{CHATS}/{chat_id}/read", format="json").status_code == 204
    mine_after = api.get(CHATS, {"role": "customer"}).json()["results"][0]
    assert mine_after["unread_count"] == 0


def test_vendor_side_list_filters_by_customer_name_only_never_phone(api, customer, vendor_client):
    handle = vendor_handle(vendor_client)
    start_chat(api, handle)

    by_name = vendor_client.get(CHATS, {"role": "vendor", "q": "Asha"}).json()
    assert by_name["count"] == 1

    by_other_name = vendor_client.get(CHATS, {"role": "vendor", "q": "Nobody"}).json()
    assert by_other_name["count"] == 0

    # Searching by the customer's actual phone digits must not work — that would let a vendor
    # discover a customer's number one digit at a time, which D14 explicitly forbids exposing.
    by_phone = vendor_client.get(CHATS, {"role": "vendor", "q": "9876543210"}).json()
    assert by_phone["count"] == 0


def test_vendor_side_never_serializes_the_customers_phone_number(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    body = vendor_client.get(f"{CHATS}/{chat_id}").json()
    assert body["other"] == {"id": str(customer.id), "name": "Asha"}
    assert "phone" not in body["other"]


# --- Block / report ----------------------------------------------------------------------------


def test_vendor_blocking_a_customer_stops_the_customer_from_sending(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    assert vendor_client.post(f"{CHATS}/{chat_id}/block", format="json").status_code == 204
    assert AuditLog.objects.filter(action="chat.blocked").exists()

    blocked_send = api.post(f"{CHATS}/{chat_id}/messages", {"text": "hello?"}, format="json")
    assert blocked_send.status_code == 403 and blocked_send.json()["error"]["code"] == "blocked"

    # the vendor who did the blocking can still send
    assert (
        vendor_client.post(f"{CHATS}/{chat_id}/messages", {"text": "we're closing this out"}, format="json").status_code
        == 201
    )

    assert vendor_client.post(f"{CHATS}/{chat_id}/unblock", format="json").status_code == 204
    assert AuditLog.objects.filter(action="chat.unblocked").exists()
    assert api.post(f"{CHATS}/{chat_id}/messages", {"text": "hello again"}, format="json").status_code == 201


def test_customer_reports_a_chat_creates_a_report_against_the_vendor(api, customer, vendor_client):
    vendor = Vendor.objects.get(handle=vendor_handle(vendor_client))
    chat_id = start_chat(api, vendor.handle)
    r = api.post(f"{CHATS}/{chat_id}/report", {"reason": "spam", "details": "sending odd links"}, format="json")
    assert r.status_code == 201
    report = Report.objects.get()
    assert report.target_type == "vendor" and report.target_id == vendor.id and report.reason == "spam"
    assert AuditLog.objects.filter(action="chat.reported").exists()


def test_vendor_reports_a_chat_creates_a_report_against_the_customer_user(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    r = vendor_client.post(f"{CHATS}/{chat_id}/report", {"reason": "abusive"}, format="json")
    assert r.status_code == 201
    report = Report.objects.get()
    assert report.target_type == "user" and report.target_id == customer.id


# --- Cross-account access control ---------------------------------------------------------------


def test_a_stranger_cannot_read_someone_elses_chat(api, customer, vendor_client):
    chat_id = start_chat(api, vendor_handle(vendor_client))
    stranger = APIClient()
    login(stranger, "9000000099", "Nosy Neighbour")
    assert stranger.get(f"{CHATS}/{chat_id}").status_code == 403
    assert stranger.get(f"{CHATS}/{chat_id}/messages").status_code == 403
    assert stranger.post(f"{CHATS}/{chat_id}/messages", {"text": "hi"}, format="json").status_code == 403


# --- Quick replies (vendor canned responses) ----------------------------------------------------


def test_vendor_manages_quick_replies(vendor_client):
    QR = "/api/v1/vendors/me/quick-replies"
    r1 = vendor_client.post(QR, {"text": "Yes, available"}, format="json")
    r2 = vendor_client.post(QR, {"text": "Sorry, out of stock"}, format="json")
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["position"] < r2.json()["position"]

    listed = vendor_client.get(QR).json()
    assert [q["text"] for q in listed] == ["Yes, available", "Sorry, out of stock"]

    assert vendor_client.delete(f"{QR}/{r1.json()['id']}").status_code == 204
    assert [q["text"] for q in vendor_client.get(QR).json()] == ["Sorry, out of stock"]


def test_quick_reply_limit_is_enforced(vendor_client):
    QR = "/api/v1/vendors/me/quick-replies"
    for i in range(20):
        assert vendor_client.post(QR, {"text": f"reply {i}"}, format="json").status_code == 201
    over_limit = vendor_client.post(QR, {"text": "one too many"}, format="json")
    assert over_limit.status_code == 400 and over_limit.json()["error"]["code"] == "quick_reply_limit"


def test_customer_cannot_manage_quick_replies(api, customer):
    assert api.get("/api/v1/vendors/me/quick-replies").status_code == 403


def test_vendor_cannot_delete_another_vendors_quick_reply(vendor_client):
    other = APIClient()
    login(other, "9123456782", "Other Owner")
    other.post(
        "/api/v1/vendors",
        {
            "shop_name": "Other Shop",
            "category_slugs": ["grocery"],
            "location": {"lat": 28.47, "lng": 77.03, "address_line": "Shop 3", "city": "Gurugram", "pincode": "122001"},
        },
        format="json",
    )
    reply = other.post("/api/v1/vendors/me/quick-replies", {"text": "Not yours"}, format="json").json()
    assert vendor_client.delete(f"/api/v1/vendors/me/quick-replies/{reply['id']}").status_code == 404
    assert QuickReply.objects.filter(id=reply["id"]).exists()


# --- N+1 regression (Phase 12 hardening) --------------------------------------------------------


def test_message_list_query_count_does_not_scale_with_product_message_count(
    django_assert_max_num_queries, api, customer, vendor_client
):
    """MessageSerializer.listing reads message.listing.{id,name,price,unit} for every "product"
    message — without select_related("listing") on the chat.messages queryset, that was one query
    per product message in the page rather than one for the whole page."""
    handle = vendor_handle(vendor_client)
    chat_id = start_chat(api, handle)

    def _share_a_product(i):
        listing = vendor_client.post(
            "/api/v1/vendor-products",
            {"category": "vegetables", "name": f"Item {i}", "price": "30", "unit": "kg"},
            format="json",
        ).json()
        r = api.post(f"{CHATS}/{chat_id}/messages", {"kind": "product", "listing_id": listing["id"]}, format="json")
        assert r.status_code == 201, r.content

    for i in range(2):
        _share_a_product(i)

    with django_assert_max_num_queries(8) as first:
        r1 = api.get(f"{CHATS}/{chat_id}/messages")
    assert r1.status_code == 200
    baseline_queries = len(first.captured_queries)

    for i in range(2, 7):
        _share_a_product(i)

    with django_assert_max_num_queries(baseline_queries) as second:
        r2 = api.get(f"{CHATS}/{chat_id}/messages")
    assert r2.status_code == 200
    assert len(r2.json()["results"]) == 7
    assert len(second.captured_queries) <= baseline_queries
