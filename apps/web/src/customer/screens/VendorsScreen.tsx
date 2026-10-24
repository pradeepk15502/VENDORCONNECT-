import { useSession, type Category, type VendorListItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, Chip, EmptyState, ErrorState, Screen, Skeleton } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { activeFilterCount, applyFiltersToUrl, DiscoveryFilterSheet, filtersFromParams, FilterButton } from "../DiscoveryFilters";
import { DiscoveryMap, markersFromVendors, ViewToggle, type ResultView } from "../DiscoveryMap";
import { VendorCard } from "../VendorCard";
import type { Place } from "../location";

/** Browse nearby shops — Home's "Shops near you" preview links here for the full list (D22). */
export function VendorsScreen({ place }: { place: Place }) {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const categorySlug = urlParams.get("category") ?? "";
  const filters = filtersFromParams(urlParams);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [view, setView] = useState<ResultView>("list");

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [items, setItems] = useState<VendorListItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    api.catalog.categories().then(setCategories).catch(() => setCategories([]));
  }, [api]);

  const load = useCallback(
    (pageToLoad: number) => {
      if (pageToLoad === 1) {
        setErr(null);
        setItems(null);
      } else {
        setLoadingMore(true);
      }
      api.vendors
        .near({
          lat: place.lat,
          lng: place.lng,
          category: categorySlug || undefined,
          radius_km: filters.radiusKm,
          open_now: filters.openNow,
          delivery: filters.delivery,
          pickup: filters.pickup,
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
    [api, categorySlug, place.lat, place.lng, filters.radiusKm, filters.openNow, filters.delivery, filters.pickup],
  );

  useEffect(() => {
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySlug, place.lat, place.lng, filters.radiusKm, filters.openNow, filters.delivery, filters.pickup]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next);
  };

  const selectCategory = (slug: string) => {
    if (slug) urlParams.set("category", slug);
    else urlParams.delete("category");
    setUrlParams(urlParams, { replace: true });
  };

  const filterCount = activeFilterCount(filters, "vendors");

  return (
    <Screen withNav>
      <AppBar title={t("nav.vendors")} />

      <div className="c-filter-row">
        <FilterButton count={filterCount} onClick={() => setFilterSheetOpen(true)} />
      </div>
      <DiscoveryFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        values={filters}
        variant="vendors"
        onApply={(v) => applyFiltersToUrl(urlParams, setUrlParams, v)}
      />

      {categories && categories.length > 0 ? (
        <div className="c-cat-row" role="group" aria-label={t("home.categories")}>
          <Chip selected={!categorySlug} onClick={() => selectCategory("")}>{t("vendors.all_categories")}</Chip>
          {categories.map((c) => (
            <Chip key={c.slug} selected={categorySlug === c.slug} onClick={() => selectCategory(c.slug)}>
              {c.names_i18n[lang] ?? c.name}
            </Chip>
          ))}
        </div>
      ) : null}

      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="store" title={t("vendors.empty")} message={t("vendors.empty_body")} />
      ) : (
        <section className="vc-stack" aria-labelledby="vendors-h">
          <div className="c-section-title">
            <h2 id="vendors-h" className="vc-h2">{t("vendors.results", { count })}</h2>
            <ViewToggle view={view} onChange={setView} />
          </div>
          {view === "map" ? (
            <DiscoveryMap place={place} items={markersFromVendors(items)} onOpen={(handle) => nav(`/v/${handle}`)} />
          ) : (
            <>
              <div className="vc-stack">
                {items.map((v) => (
                  <VendorCard key={v.handle} item={v} onOpen={() => nav(`/v/${v.handle}`)} />
                ))}
              </div>
              {items.length < count ? (
                <Button variant="secondary" block loading={loadingMore} onClick={loadMore}>
                  {t("search.load_more")}
                </Button>
              ) : null}
            </>
          )}
        </section>
      )}
    </Screen>
  );
}
