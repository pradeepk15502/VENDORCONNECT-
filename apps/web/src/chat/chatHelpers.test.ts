import { describe, expect, it } from "vitest";
import { isVendorRef, lastMessagePreview, otherDisplayName } from "./chatHelpers";

const t = (key: string, vars?: Record<string, string | number>) => {
  const dict: Record<string, string> = {
    "chat.preview_product": "Shared a product",
    "chat.preview_other": "Sent a message",
    "chat.you_prefix": "You: {text}",
  };
  let s = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

const VENDOR = { handle: "SHARMA001", vendor_id: "@SHARMA001", shop_name: "Sharma Vegetable Store", is_open: true, public_phone: "+919990000001" };
const CUSTOMER = { id: "u1", name: "Asha" };

describe("isVendorRef / otherDisplayName", () => {
  it("recognises a vendor ref by its handle field", () => {
    expect(isVendorRef(VENDOR)).toBe(true);
    expect(isVendorRef(CUSTOMER)).toBe(false);
  });
  it("displays the shop name for a vendor, the person's name for a customer", () => {
    expect(otherDisplayName(VENDOR)).toBe("Sharma Vegetable Store");
    expect(otherDisplayName(CUSTOMER)).toBe("Asha");
  });
});

describe("lastMessagePreview", () => {
  it("returns null when there is no last message", () => {
    expect(lastMessagePreview(t, "customer", null)).toBeNull();
  });
  it("shows the text as-is when sent by the other side", () => {
    const msg = { text: "Do you have tomatoes?", kind: "text" as const, sender_side: "customer" as const, created_at: "2026-01-01T00:00:00Z" };
    expect(lastMessagePreview(t, "vendor", msg)).toBe("Do you have tomatoes?");
  });
  it("prefixes 'You: ' when the viewer sent the last message", () => {
    const msg = { text: "Yes, in stock", kind: "text" as const, sender_side: "vendor" as const, created_at: "2026-01-01T00:00:00Z" };
    expect(lastMessagePreview(t, "vendor", msg)).toBe("You: Yes, in stock");
  });
  it("shows a generic label for a product-share message, not the raw kind", () => {
    const msg = { text: "", kind: "product" as const, sender_side: "vendor" as const, created_at: "2026-01-01T00:00:00Z" };
    expect(lastMessagePreview(t, "customer", msg)).toBe("Shared a product");
  });
});
