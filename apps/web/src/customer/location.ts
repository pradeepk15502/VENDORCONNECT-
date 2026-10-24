/* Customer location stays on the device (ARCHITECTURE D11). Sent per request only when searching. */
export type Place = { lat: number; lng: number; label: string; source: "gps" | "manual" };

export const CITIES: Place[] = [
  { label: "Gurugram", lat: 28.4595, lng: 77.0266, source: "manual" },
  { label: "New Delhi", lat: 28.6139, lng: 77.209, source: "manual" },
  { label: "Noida", lat: 28.5355, lng: 77.391, source: "manual" },
  { label: "Bengaluru", lat: 12.9716, lng: 77.5946, source: "manual" },
  { label: "Mumbai", lat: 19.076, lng: 72.8777, source: "manual" },
  { label: "Patna", lat: 25.5941, lng: 85.1376, source: "manual" },
  { label: "Siwan", lat: 26.2196, lng: 84.3567, source: "manual" },
  { label: "Lucknow", lat: 26.8467, lng: 80.9462, source: "manual" },
];

const KEY = "vc.place";

export function loadPlace(): Place | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Place) : null;
  } catch {
    return null;
  }
}

export function savePlace(p: Place) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export type GeoError = "denied" | "unavailable";

export function getGpsPosition(timeoutMs = 10000): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject("unavailable" as GeoError);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, label: "", source: "gps" }),
      (e) => reject((e.code === e.PERMISSION_DENIED ? "denied" : "unavailable") as GeoError),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export const flags = {
  get(k: string) {
    try {
      return localStorage.getItem(`vc.flag.${k}`) === "1";
    } catch {
      return false;
    }
  },
  set(k: string) {
    try {
      localStorage.setItem(`vc.flag.${k}`, "1");
    } catch {
      /* ignore */
    }
  },
};
