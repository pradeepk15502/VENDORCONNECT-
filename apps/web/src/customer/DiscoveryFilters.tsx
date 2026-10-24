import { useI18n } from "@vc/i18n";
import { Button, Chip, Icon, Modal, TextField } from "@vc/ui";
import { useEffect, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";

/**
 * Shared filter state for Search and Vendors (master-prompt §11, ARCHITECTURE D26). Every field
 * defaults to "don't narrow" (undefined/false), matching the backend's opt-in filter params —
 * the default browse/search experience is unchanged unless the customer turns a filter on.
 */
export type DiscoveryFilterValues = {
  radiusKm?: number;
  openNow: boolean;
  delivery: boolean;
  pickup: boolean;
  /** Search only. */
  inStockOnly: boolean;
  priceMin?: number;
  priceMax?: number;
};

export const DEFAULT_FILTERS: DiscoveryFilterValues = {
  radiusKm: undefined,
  openNow: false,
  delivery: false,
  pickup: false,
  inStockOnly: false,
  priceMin: undefined,
  priceMax: undefined,
};

// Preset distance chips (master-prompt §11). "Any distance" maps to the server's own search
// radius ceiling (services/api config.settings.base.SEARCH_RADIUS_KM_MAX) — there's no unbounded
// option in a hyperlocal app, so "any" means "as far as this app ever searches."
const ANY_DISTANCE_KM = 25;
const DISTANCE_PRESETS: { km: number; key: "filters.distance_1" | "filters.distance_3" | "filters.distance_5" | "filters.distance_any" }[] = [
  { km: 1, key: "filters.distance_1" },
  { km: 3, key: "filters.distance_3" },
  { km: 5, key: "filters.distance_5" },
  { km: ANY_DISTANCE_KM, key: "filters.distance_any" },
];

/** Reads filter values from the screen's URL params (same pattern as the existing `category` param). */
export function filtersFromParams(params: URLSearchParams): DiscoveryFilterValues {
  const num = (key: string) => {
    const v = params.get(key);
    return v ? Number(v) : undefined;
  };
  return {
    radiusKm: num("radius_km"),
    openNow: params.get("open_now") === "1",
    delivery: params.get("delivery") === "1",
    pickup: params.get("pickup") === "1",
    inStockOnly: params.get("in_stock_only") === "1",
    priceMin: num("price_min"),
    priceMax: num("price_max"),
  };
}

/** Writes filter values back into the URL (drops keys that are at their default, keeping links tidy). */
function writeFiltersToParams(params: URLSearchParams, v: DiscoveryFilterValues) {
  const set = (key: string, value: string | undefined) => (value ? params.set(key, value) : params.delete(key));
  set("radius_km", v.radiusKm ? String(v.radiusKm) : undefined);
  set("open_now", v.openNow ? "1" : undefined);
  set("delivery", v.delivery ? "1" : undefined);
  set("pickup", v.pickup ? "1" : undefined);
  set("in_stock_only", v.inStockOnly ? "1" : undefined);
  set("price_min", v.priceMin ? String(v.priceMin) : undefined);
  set("price_max", v.priceMax ? String(v.priceMax) : undefined);
}

export function activeFilterCount(v: DiscoveryFilterValues, variant: "search" | "vendors"): number {
  let n = 0;
  if (v.radiusKm) n++;
  if (v.openNow) n++;
  if (v.delivery) n++;
  if (v.pickup) n++;
  if (variant === "search") {
    if (v.inStockOnly) n++;
    if (v.priceMin || v.priceMax) n++;
  }
  return n;
}

/** The "Filters" trigger — a chip-styled button with an active-count badge, opening the sheet. */
export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="vc-chip c-filter-btn" aria-pressed={count > 0} onClick={onClick}>
      <Icon name="filter" size={18} />
      {count > 0 ? t("filters.button_active", { count }) : t("filters.button")}
    </button>
  );
}

/** The filter sheet itself — a `Modal` with distance/open-now/delivery/pickup, plus (search only)
 * in-stock and price range. Edits are local until "Show results" applies them, and "Clear all"
 * resets everything to the defaults in one tap. */
export function DiscoveryFilterSheet({
  open,
  onClose,
  values,
  onApply,
  variant,
}: {
  open: boolean;
  onClose: () => void;
  values: DiscoveryFilterValues;
  onApply: (v: DiscoveryFilterValues) => void;
  variant: "search" | "vendors";
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(values);
  useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  const apply = () => {
    onApply(draft);
    onClose();
  };
  const clear = () => {
    setDraft(DEFAULT_FILTERS);
    onApply(DEFAULT_FILTERS);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("filters.title")}>
      <div className="vc-stack">
        <section className="c-filter-group">
          <h3 className="c-filter-group__title">{t("filters.distance")}</h3>
          <div className="c-filter-group__chips">
            {DISTANCE_PRESETS.map((p) => (
              <Chip key={p.km} selected={draft.radiusKm === p.km} onClick={() => setDraft({ ...draft, radiusKm: p.km })}>
                {t(p.key)}
              </Chip>
            ))}
          </div>
        </section>

        <section className="c-filter-group">
          <h3 className="c-filter-group__title">{t("filters.shop_status")}</h3>
          <div className="c-filter-group__chips">
            <Chip selected={draft.openNow} onClick={() => setDraft({ ...draft, openNow: !draft.openNow })}>
              {t("filters.open_now")}
            </Chip>
          </div>
        </section>

        <section className="c-filter-group">
          <h3 className="c-filter-group__title">{t("filters.fulfilment")}</h3>
          <div className="c-filter-group__chips">
            <Chip selected={draft.delivery} onClick={() => setDraft({ ...draft, delivery: !draft.delivery })}>
              {t("filters.delivery")}
            </Chip>
            <Chip selected={draft.pickup} onClick={() => setDraft({ ...draft, pickup: !draft.pickup })}>
              {t("filters.pickup")}
            </Chip>
          </div>
        </section>

        {variant === "search" ? (
          <>
            <section className="c-filter-group">
              <h3 className="c-filter-group__title">{t("filters.availability")}</h3>
              <div className="c-filter-group__chips">
                <Chip selected={draft.inStockOnly} onClick={() => setDraft({ ...draft, inStockOnly: !draft.inStockOnly })}>
                  {t("filters.in_stock")}
                </Chip>
              </div>
            </section>

            <section className="c-filter-group">
              <h3 className="c-filter-group__title">{t("filters.price_range")}</h3>
              <div className="c-filter-group__price">
                <TextField
                  label={t("filters.price_min_ph")}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={draft.priceMin ?? ""}
                  onChange={(e) => setDraft({ ...draft, priceMin: e.target.value ? Number(e.target.value) : undefined })}
                />
                <TextField
                  label={t("filters.price_max_ph")}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={draft.priceMax ?? ""}
                  onChange={(e) => setDraft({ ...draft, priceMax: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
            </section>
          </>
        ) : null}

        <div className="c-filter-actions">
          <Button variant="secondary" onClick={clear}>{t("filters.clear")}</Button>
          <Button onClick={apply}>{t("filters.apply")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Convenience hook: reads filters from the URL, and returns a setter that writes them back
 * (mirroring how `category` is already handled in SearchScreen/VendorsScreen via useSearchParams). */
export function applyFiltersToUrl(urlParams: URLSearchParams, setUrlParams: SetURLSearchParams, values: DiscoveryFilterValues) {
  const next = new URLSearchParams(urlParams);
  writeFiltersToParams(next, values);
  setUrlParams(next, { replace: true });
}
