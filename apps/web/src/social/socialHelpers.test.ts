import { describe, expect, it } from "vitest";
import { timeAgo } from "./socialHelpers";

const t = (key: string, vars?: Record<string, string | number>) => {
  const dict: Record<string, string> = {
    "time.just_now": "Just now",
    "time.minutes_ago": "{n}m ago",
    "time.hours_ago": "{n}h ago",
    "time.days_ago": "{n}d ago",
  };
  let s = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

describe("timeAgo", () => {
  // `timeAgo` reads the real clock (`Date.now()`), so each case computes its input relative to
  // whenever the test actually runs rather than a fixed timestamp.
  const now = Date.now();

  it("shows 'just now' under a minute", () => {
    expect(timeAgo(new Date(now - 30_000).toISOString(), t, "en")).toBe("Just now");
  });

  it("shows minutes for under an hour", () => {
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), t, "en")).toBe("5m ago");
  });

  it("shows hours for under a day", () => {
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), t, "en")).toBe("3h ago");
  });

  it("shows days for under a month", () => {
    expect(timeAgo(new Date(now - 4 * 86_400_000).toISOString(), t, "en")).toBe("4d ago");
  });

  it("falls back to a plain date once older than a month", () => {
    const iso = new Date(now - 40 * 86_400_000).toISOString();
    const result = timeAgo(iso, t, "en");
    expect(result).not.toMatch(/ago$/);
    expect(result.length).toBeGreaterThan(0);
  });
});
