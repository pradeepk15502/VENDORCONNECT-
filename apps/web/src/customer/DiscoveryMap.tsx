import type { SearchResultItem, VendorListItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { directionsUrl, formatDistance } from "./format";
import type { Place } from "./location";

/** One pin on the map — the shared shape both SearchScreen and VendorsScreen reduce their own
 * result types down to, so this component doesn't need to know about search results vs vendor
 * cards. `handle` is the vendor's public handle, never a database id (master-prompt §10). */
export type MapMarkerItem = {
  handle: string;
  name: string;
  lat: number;
  lng: number;
  isOpen: boolean;
  distanceKm: number;
};

function dotIcon(kind: "open" | "closed"): L.DivIcon {
  return L.divIcon({
    className: `c-map-pin c-map-pin--${kind}`,
    html: '<span class="c-map-pin__dot"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}
const OPEN_ICON = dotIcon("open");
const CLOSED_ICON = dotIcon("closed");
const YOU_ARE_HERE_ICON = L.divIcon({
  className: "c-map-you",
  html: '<span class="c-map-you__ring"></span><span class="c-map-you__dot"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/** /search returns one row per listing, so several rows can share a vendor — collapse to one
 * marker per shop (the nearest-ranked listing wins), and skip the rare vendor with no location. */
export function markersFromSearchResults(items: SearchResultItem[]): MapMarkerItem[] {
  const seen = new Set<string>();
  const markers: MapMarkerItem[] = [];
  for (const item of items) {
    const v = item.vendor;
    if (v.lat == null || v.lng == null || seen.has(v.handle)) continue;
    seen.add(v.handle);
    markers.push({ handle: v.handle, name: v.shop_name, lat: v.lat, lng: v.lng, isOpen: v.is_open, distanceKm: item.distance_km });
  }
  return markers;
}

/** /vendors is already one row per shop; only `location` can be missing (never set up). */
export function markersFromVendors(items: VendorListItem[]): MapMarkerItem[] {
  const markers: MapMarkerItem[] = [];
  for (const v of items) {
    if (!v.location) continue;
    markers.push({ handle: v.handle, name: v.shop_name, lat: v.location.lat, lng: v.location.lng, isOpen: v.is_open, distanceKm: v.distance_km });
  }
  return markers;
}

export type ResultView = "list" | "map";

/** The List/Map segmented control shared by SearchScreen and VendorsScreen. */
export function ViewToggle({ view, onChange }: { view: ResultView; onChange: (v: ResultView) => void }) {
  const { t } = useI18n();
  return (
    <div className="c-view-toggle" role="group" aria-label={t("view.map")}>
      {(["list", "map"] as const).map((v) => (
        <button
          key={v}
          type="button"
          className={`c-view-toggle__btn${view === v ? " is-active" : ""}`}
          aria-pressed={view === v}
          onClick={() => onChange(v)}
        >
          {t(v === "list" ? "view.list" : "view.map")}
        </button>
      ))}
    </div>
  );
}

/**
 * Leaflet + OpenStreetMap tiles — the default `MapProvider` from ARCHITECTURE D13 (no API key,
 * fine for dev; production should move to a paid/self-hosted tile provider per OSM's usage
 * policy). A thin imperative wrapper, not react-leaflet: Leaflet owns the DOM inside `elRef`,
 * React only tells it when the center or the marker list changes.
 *
 * Clicking a marker opens a popup with the shop name, status and distance, and two real actions:
 * "View shop" (routes to the same vendor profile the list view links to) and "Directions" (opens
 * the device's own maps app / Google Maps — the same link the vendor profile's About tab uses).
 */
export function DiscoveryMap({ place, items, onOpen }: { place: Place; items: MapMarkerItem[]; onOpen: (handle: string) => void }) {
  const { t } = useI18n();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Create the map once. Leaflet needs a mounted element with a real size, so this only runs
  // after the div is in the DOM, and is torn down on unmount to avoid leaking tile requests.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const map = L.map(el, { attributionControl: true }).setView([place.lat, place.lng], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time setup; recentering below reacts to place changes
  }, []);

  // Recenter (without resetting zoom) when the customer switches location.
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.setView([place.lat, place.lng], map.getZoom());
  }, [place.lat, place.lng]);

  // Redraw markers whenever the (already filtered) result list changes.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Not interactive: a nearby shop's marker can sit almost exactly under this one (D9's own
    // "near you" test data is ~50 m away), and a real user needs to be able to click straight
    // through this dot to reach that shop's marker underneath it rather than get blocked by it.
    L.marker([place.lat, place.lng], { icon: YOU_ARE_HERE_ICON, title: t("map.your_location"), interactive: false, keyboard: false, zIndexOffset: 1000 })
      .addTo(layer);

    for (const item of items) {
      const popup = document.createElement("div");
      popup.className = "c-map-popup";
      const nameEl = document.createElement("strong");
      nameEl.textContent = item.name;
      const metaEl = document.createElement("span");
      metaEl.textContent = `${item.isOpen ? t("status.open") : t("status.closed")} · ${formatDistance(t, item.distanceKm)}`;
      const actions = document.createElement("div");
      actions.className = "c-map-popup__actions";
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "vc-btn vc-btn--primary vc-btn--md";
      viewBtn.textContent = t("map.view_shop");
      viewBtn.addEventListener("click", () => onOpenRef.current(item.handle));
      const dirLink = document.createElement("a");
      dirLink.className = "vc-btn vc-btn--secondary vc-btn--md";
      dirLink.textContent = t("map.directions");
      dirLink.href = directionsUrl(item.lat, item.lng);
      dirLink.target = "_blank";
      dirLink.rel = "noopener noreferrer";
      actions.append(viewBtn, dirLink);
      popup.append(nameEl, metaEl, actions);

      L.marker([item.lat, item.lng], { icon: item.isOpen ? OPEN_ICON : CLOSED_ICON, alt: item.name, title: item.name })
        .bindPopup(popup)
        .addTo(layer);
    }
  }, [items, place.lat, place.lng, t]);

  return (
    <div className="c-map-wrap">
      <div ref={elRef} className="c-map" role="application" aria-label={t("view.map")} />
      <div className="c-map-legend">
        <span><span className="c-map-legend__dot c-map-legend__dot--open" />{t("map.legend_open")}</span>
        <span><span className="c-map-legend__dot c-map-legend__dot--closed" />{t("map.legend_closed")}</span>
      </div>
    </div>
  );
}
