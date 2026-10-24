import type { MessageKey } from "@vc/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** A short "2h ago" / "3d ago" relative timestamp for reviews and posts (master prompt §21's
 * "time-ago" review display). Falls back to a plain date once it's more than a month old — a
 * relative count in months/years reads worse than just the date at that distance. */
export function timeAgo(iso: string, t: T, lang: "en" | "hi"): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return t("time.just_now");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("time.minutes_ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t("time.days_ago", { n: days });
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
