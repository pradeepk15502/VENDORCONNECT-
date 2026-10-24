import type { MessageKey } from "@vc/i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Shared between Search results and vendor-list cards (Home "Shops near you", Vendors tab). */
export function formatDistance(t: T, km: number): string {
  return km < 1 ? t("search.away_m", { m: Math.round(km * 1000) }) : t("search.away_km", { km: km.toFixed(1) });
}

/** A universal maps link (ARCHITECTURE D13) — opens the device's own maps app on mobile and
 * Google Maps on desktop, without needing a `geo:` URI that only mobile browsers understand. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
