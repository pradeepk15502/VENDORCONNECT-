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
  }
  if (err.status >= 500) return t("common.error_server");
  return err.message || t("common.error_title");
}
