import { useSession, type Category, type SearchResultItem, type VendorPublic } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, EmptyState, ErrorState, Icon, Screen, Skeleton, StatusBadge, TextField } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { activeFilterCount, applyFiltersToUrl, DiscoveryFilterSheet, filtersFromParams, FilterButton } from "../DiscoveryFilters";
import { DiscoveryMap, markersFromSearchResults, ViewToggle, type ResultView } from "../DiscoveryMap";
import { formatDistance } from "../format";
import type { Place } from "../location";
import { looksLikeVendorHandle } from "../vendorHandle";
import { formatUnit } from "../../shared/units";

/** Debounces the query so we don't fire a request on every keystroke. */
function useDebounced<Val>(value: Val, delayMs: number): Val {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function ResultCard({ item, onOpen }: { item: SearchResultItem; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="c-result" onClick={onOpen}>
      <span className="c-result__top">
        <span className="c-result__name">{item.name}</span>
        <span className="c-result__price">
          ₹{item.price}
          <span className="vc-muted" style={{ fontWeight: 400 }}> / {formatUnit(t, item.unit, item.unit_quantity)}</span>
          {item.mrp && Number(item.mrp) > Number(item.price) ? <span className="c-result__mrp">₹{item.mrp}</span> : null}
        </span>
      </span>
      <span className="c-result__vendor">
        <Icon name="store" size={16} />
        {item.vendor.shop_name}
        <span aria-hidden="true">·</span>
        <Icon name="pin" size={16} />
        {formatDistance(t, item.distance_km)}
      </span>
      <span className="c-result__badges">
        <StatusBadge kind={item.vendor.is_open ? "open" : "closed"} size="sm" label={item.vendor.is_open ? t("status.open") : t("status.closed")} />
        <StatusBadge kind={item.availability} size="sm" label={t(`avail.${item.availability}` as MessageKey)} />
        {item.freshness !== "fresh" ? <StatusBadge kind="stale" size="sm" label={t(`freshness.${item.freshness}` as MessageKey)} /> : null}
        {item.vendor.delivery_enabled ? <StatusBadge kind="delivery" size="sm" label={t("v.delivery_on")} /> : <StatusBadge kind="pickup_only" size="sm" label={t("v.pickup_only")} />}
      </span>
    </button>
  );
}

export function SearchScreen({ place }: { place: Place }) {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const categorySlug = urlParams.get("category") ?? "";
  const filters = filtersFromParams(urlParams);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [view, setView] = useState<ResultView>("list");

  const [q, setQ] = useState(urlParams.get("q") ?? "");
  const debouncedQ = useDebounced(q.trim(), 350);

  const [items, setItems] = useState<SearchResultItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [shopMatch, setShopMatch] = useState<VendorPublic | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);

  const active = debouncedQ !== "" || categorySlug !== "" || activeFilterCount(filters, "search") > 0;
  const categoryName = categories?.find((c) => c.slug === categorySlug)?.names_i18n[lang]
    ?? categories?.find((c) => c.slug === categorySlug)?.name
    ?? categorySlug;

  useEffect(() => {
    if (categorySlug && !categories) api.catalog.categories().then(setCategories).catch(() => setCategories([]));
  }, [api, categorySlug, categories]);

  const load = useCallback(
    (pageToLoad: number) => {
      if (!active) {
        setItems(null);
        setErr(null);
        return;
      }
      if (pageToLoad === 1) {
        setErr(null);
        setItems(null);
      } else {
        setLoadingMore(true);
      }
      api.catalog
        .search({
          q: debouncedQ,
          lat: place.lat,
          lng: place.lng,
          category: categorySlug || undefined,
          radius_km: filters.radiusKm,
          in_stock_only: filters.inStockOnly,
          open_now: filters.openNow,
          delivery: filters.delivery,
          pickup: filters.pickup,
          price_min: filters.priceMin,
          price_max: filters.priceMax,
          page: pageToLoad,
        })
        .then((res) => {
          setCount(res.count);
          setItems((prev) => (pageToLoad > 1 && prev ? [...prev, ...res.results] : res.results));
        })
        .catch((e) => {
          if (pageToLoad === 1) setErr(e); // a failed "load more" keeps what's already on screen
        })
        .finally(() => setLoadingMore(false));
    },
    // filters' fields are read individually below so this callback only changes when a value
    // actually differs, not on every render (filtersFromParams() returns a fresh object each time).
    [
      active,
      api,
      debouncedQ,
      categorySlug,
      place.lat,
      place.lng,
      filters.radiusKm,
      filters.inStockOnly,
      filters.openNow,
      filters.delivery,
      filters.pickup,
      filters.priceMin,
      filters.priceMax,
    ],
  );

  useEffect(() => {
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedQ,
    categorySlug,
    place.lat,
    place.lng,
    filters.radiusKm,
    filters.inStockOnly,
    filters.openNow,
    filters.delivery,
    filters.pickup,
    filters.priceMin,
    filters.priceMax,
  ]);

  useEffect(() => {
    if (!looksLikeVendorHandle(debouncedQ)) {
      setShopMatch(null);
      return;
    }
    let cancelled = false;
    api.vendors
      .byHandle(debouncedQ)
      .then((v) => !cancelled && setShopMatch(v))
      .catch(() => !cancelled && setShopMatch(null));
    return () => {
      cancelled = true;
    };
  }, [api, debouncedQ]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next);
  };

  const clearCategory = () => {
    urlParams.delete("category");
    setUrlParams(urlParams, { replace: true });
  };

  const filterCount = activeFilterCount(filters, "search");

  return (
    <Screen withNav>
      <AppBar title={t("nav.search")} />
      <TextField
        label={t("nav.search")}
        placeholder={t("home.search_ph")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        enterKeyHint="search"
        autoFocus
      />
      <div className="c-filter-row">
        <FilterButton count={filterCount} onClick={() => setFilterSheetOpen(true)} />
        {categorySlug ? (
          <button type="button" className="vc-chip is-selected" onClick={clearCategory} aria-label={t("search.clear_filter")}>
            <Icon name="x" size={16} />
            {t("search.category_prefix", { name: categoryName })}
          </button>
        ) : null}
      </div>
      <DiscoveryFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        values={filters}
        variant="search"
        onApply={(v) => applyFiltersToUrl(urlParams, setUrlParams, v)}
      />

      {shopMatch ? (
        <section aria-labelledby="shop-match-h">
          <h2 id="shop-match-h" className="vc-h2">{t("search.shop_found")}</h2>
          <button type="button" className="c-result" onClick={() => nav(`/v/${shopMatch.handle}`)}>
            <span className="c-result__top">
              <span className="c-result__name">{shopMatch.shop_name}</span>
              <span className="vc-muted">{shopMatch.vendor_id}</span>
            </span>
            <span className="c-result__badges">
              <StatusBadge kind={shopMatch.is_open ? "open" : "closed"} size="sm" label={shopMatch.is_open ? t("status.open") : t("status.closed")} />
              {shopMatch.verified ? <StatusBadge kind="verified" size="sm" label={t("v.verified")} /> : null}
            </span>
          </button>
        </section>
      ) : null}

      {!active ? (
        <EmptyState icon="search" title={t("search.start_typing")} />
      ) : err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={4} />
      ) : items.length === 0 && !shopMatch ? (
        <EmptyState icon="search" title={t("search.no_results")} message={t("search.no_results_body")} />
      ) : (
        <section className="vc-stack" aria-labelledby="results-h">
          {items.length > 0 ? (
            <>
              <div className="c-section-title">
                <h2 id="results-h" className="vc-h2">{t("search.results", { count })}</h2>
                <ViewToggle view={view} onChange={setView} />
              </div>
              {view === "map" ? (
                <DiscoveryMap place={place} items={markersFromSearchResults(items)} onOpen={(handle) => nav(`/v/${handle}`)} />
              ) : (
                <>
                  <div className="vc-stack">
                    {items.map((r) => (
                      <ResultCard key={r.id} item={r} onOpen={() => nav(`/v/${r.vendor.handle}`)} />
                    ))}
                  </div>
                  {items.length < count ? (
                    <Button variant="secondary" block loading={loadingMore} onClick={loadMore}>
                      {t("search.load_more")}
                    </Button>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </section>
      )}
    </Screen>
  );
}
