from django.urls import path

from . import views

urlpatterns = [
    path("chats", views.ChatCollectionView.as_view(), name="chat-collection"),
    path("chats/<uuid:chat_id>", views.ChatDetailView.as_view(), name="chat-detail"),
    path("chats/<uuid:chat_id>/messages", views.ChatMessagesView.as_view(), name="chat-messages"),
    path("chats/<uuid:chat_id>/read", views.ChatReadView.as_view(), name="chat-read"),
    path("chats/<uuid:chat_id>/block", views.ChatBlockView.as_view(blocked_value=True), name="chat-block"),
    path("chats/<uuid:chat_id>/unblock", views.ChatBlockView.as_view(blocked_value=False), name="chat-unblock"),
    path("chats/<uuid:chat_id>/report", views.ChatReportView.as_view(), name="chat-report"),
    path("vendors/me/quick-replies", views.QuickReplyCollectionView.as_view(), name="quick-reply-collection"),
    path("vendors/me/quick-replies/<int:reply_id>", views.QuickReplyDetailView.as_view(), name="quick-reply-detail"),
]
