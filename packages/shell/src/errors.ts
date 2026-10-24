import { ApiError } from "@vc/api-client";
import type { MessageKey } from "@vc/i18n";

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** Map API errors to short, translated, user-facing messages. */
export function errorMessage(err: unknown, t: T): string {
  if (!(err instanceof ApiError)) return t("common.error_title");
  if (err.isNetwork) return t("common.error_network");
  switch (err.code) {
    case "otp_invalid":
      return t("auth.err.otp_invalid");
    case "otp_locked":
      return t("auth.err.otp_locked");
    case "otp_cooldown":
    case "otp_rate_limited":
    case "rate_limited":
      return t("auth.err.rate", { s: Number(err.details?.retry_after_seconds ?? 60) });
    case "account_suspended":
      return t("auth.err.suspended");
    /* Phase 8: checkout/order errors carry their own human-readable message from the server, but
     * mapping the known codes keeps Hindi speakers from seeing raw English server text. */
    case "cart_empty":
      return t("checkout.err.cart_empty");
    case "items_unavailable":
      return t("checkout.err.items_unavailable");
    case "pickup_unavailable":
      return t("checkout.err.pickup_unavailable");
    case "vendor_closed":
      return t("checkout.err.vendor_closed");
    case "vendor_unavailable":
      return t("checkout.err.vendor_unavailable");
    case "payment_failed":
      return t("checkout.err.payment_failed");
    case "payment_provider_unavailable":
      return t("checkout.err.payment_provider_unavailable");
    case "cannot_order_own_shop":
      return t("checkout.err.cannot_order_own_shop");
    case "delivery_ineligible": {
      const reason = String(err.details?.reason ?? "");
      const key = (
        { delivery_disabled: "checkout.err.delivery_disabled", address_missing_location: "checkout.err.address_missing_location",
          outside_radius: "checkout.err.outside_radius", below_minimum: "checkout.err.below_minimum" } as Record<string, MessageKey>
      )[reason];
      return key ? t(key) : err.message;
    }
    /* Phase 9: following/posts/reviews errors. */
    case "cannot_follow_own_shop":
      return t("social.err.cannot_follow_own_shop");
    case "invalid_media":
      return t("social.err.invalid_media");
    case "invalid_listing":
      return t("social.err.invalid_listing");
    case "order_not_completed":
      return t("social.err.order_not_completed");
    case "already_reviewed":
      return t("social.err.already_reviewed");
  }
  if (err.status >= 500) return t("common.error_server");
  return err.message || t("common.error_title");
}
