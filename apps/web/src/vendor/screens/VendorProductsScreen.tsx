import { useSession, type Availability, type Category, type VendorProductItem } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Chip, EmptyState, ErrorState, Icon, Screen, Skeleton, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnit } from "../../shared/units";

const NEXT_AVAILABILITY: Record<Availability, Availability> = {
  in_stock: "low_stock",
  low_stock: "out_of_stock",
  out_of_stock: "in_stock",
};

function Row({ item, onOpen, onToggleAvailability, toggling }: { item: VendorProductItem; onOpen: () => void; onToggleAvailability: () => void; toggling: boolean }) {
  const { t } = useI18n();
  return (
    <li className="v-prow">
      <button type="button" className="v-prow__main" onClick={onOpen}>
        <span className="v-prow__top">
          <span className="v-prow__name">{item.name}</span>
          <span className="v-prow__price">
            ₹{item.price}
            <span className="vc-muted" style={{ fontWeight: 400 }}> / {formatUnit(t, item.unit, item.unit_quantity)}</span>
          </span>
        </span>
        <span className="v-prow__meta">
          {item.status === "paused" ? <span className="vc-chip v-prow__paused">{t("v.plist.paused")}</span> : null}
          {item.freshness !== "fresh" ? <StatusBadge kind="stale" size="sm" label={t(`freshness.${item.freshness}` as MessageKey)} /> : null}
        </span>
      </button>
      <button
        type="button"
        className="v-prow__avail"
        onClick={onToggleAvailability}
        disabled={toggling}
        aria-label={t("v.plist.cycle_availability")}
      >
        <StatusBadge kind={item.availability} size="sm" label={t(`avail.${item.availability}` as MessageKey)} />
      </button>
    </li>
  );
}

export function VendorProductsScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [categorySlug, setCategorySlug] = useState("");
  const [items, setItems] = useState<VendorProductItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [toggleErr, setToggleErr] = useState<string>();
  const [togglingId, setTogglingId] = useState<string>();

  useEffect(() => {
    api.catalog.categories().then(setCats).catch(() => undefined);
  }, [api]);

  const load = useCallback(() => {
    setErr(null);
    api.vendorProducts
      .list({ category: categorySlug || undefined, page_size: 100 })
      .then((r) => setItems(r.results))
      .catch(setErr);
  }, [api, categorySlug]);
  useEffect(load, [load]);

  async function toggleAvailability(item: VendorProductItem) {
    setTogglingId(item.id);
    setToggleErr(undefined);
    try {
      const updated = await api.inventory.update({ listing_id: item.id, availability: NEXT_AVAILABILITY[item.availability] });
      setItems((prev) => prev?.map((x) => (x.id === item.id ? updated : x)) ?? prev);
    } catch (e) {
      setToggleErr(errorMessage(e, t));
    } finally {
      setTogglingId(undefined);
    }
  }

  return (
    <Screen withNav>
      <AppBar
        title={t("nav.products")}
        right={
          <button className="vc-iconbtn" onClick={() => nav("/vendor/products/new")} aria-label={t("v.plist.add")}>
            <Icon name="plus" />
          </button>
        }
      />

      {cats && cats.length > 0 ? (
        <div className="vc-row v-plist__filters" role="group" aria-label={t("v.plist.filter_label")}>
          <Chip selected={!categorySlug} onClick={() => setCategorySlug("")}>{t("vendors.all_categories")}</Chip>
          {cats.map((c) => (
            <Chip key={c.slug} icon={c.icon} selected={categorySlug === c.slug} onClick={() => setCategorySlug(c.slug)}>
              {c.names_i18n[lang] ?? c.name}
            </Chip>
          ))}
        </div>
      ) : null}

      {toggleErr ? <Banner tone="error" icon="alert">{toggleErr}</Banner> : null}

      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="box"
          title={t("v.plist.empty_title")}
          message={t("v.plist.empty_body")}
          action={<Button onClick={() => nav("/vendor/products/new")}>{t("v.plist.add")}</Button>}
        />
      ) : (
        <ul className="v-plist">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onOpen={() => nav(`/vendor/products/${item.id}/edit`)}
              onToggleAvailability={() => toggleAvailability(item)}
              toggling={togglingId === item.id}
            />
          ))}
        </ul>
      )}
    </Screen>
  );
}
