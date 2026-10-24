import type { ChatCustomerRef, ChatLastMessage, ChatRole, ChatVendorRef } from "@vc/api-client";
import type { Lang, MessageKey } from "@vc/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** `ChatItem.other`'s shape depends on which `role` it was fetched as (see ARCHITECTURE D28) —
 * this narrows it without needing a discriminant field from the server. */
export function isVendorRef(other: ChatVendorRef | ChatCustomerRef): other is ChatVendorRef {
  return "handle" in other;
}

export function otherDisplayName(other: ChatVendorRef | ChatCustomerRef): string {
  return isVendorRef(other) ? other.shop_name : other.name;
}

/** A short "You: ..." / plain preview of a chat's last message for the conversation list. */
export function lastMessagePreview(t: T, role: ChatRole, msg: ChatLastMessage | null): string | null {
  if (!msg) return null;
  const body = msg.kind === "product" ? t("chat.preview_product") : msg.kind === "text" ? msg.text : t("chat.preview_other");
  return msg.sender_side === role ? t("chat.you_prefix", { text: body }) : body;
}

export function formatMessageTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
