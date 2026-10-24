import { useOnline, useSession, type VendorOwner, type VendorSummary } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { Banner, ErrorState, Icon, Loading, OfflineBanner, Screen, ShopStatusToggle, StatusBadge, Tile } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/** Product/low-stock/out-of-stock counts for the overview tiles, from the real Phase 5 summary
 * endpoint (GET /vendors/me/summary) — one query server-side instead of three filtered list calls. */
function useProductStats(api: ReturnType<typeof useSession>["api"]) {
  const [stats, setStats] = useState<VendorSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.vendors
      .summary()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);
  return stats;
}

function greetingKey(): MessageKey {
  const h = new Date().getHours();
  if (h < 12) return "v.dash.greeting_morning";
  if (h < 17) return "v.dash.greeting_afternoon";
  return "v.dash.greeting_evening";
}

export function DashboardScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const online = useOnline();
  const nav = useNavigate();
  const [v, setV] = useState<VendorOwner | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [toggleErr, setToggleErr] = useState<string>();
  const stats = useProductStats(api);

  const load = useCallback(() => {
    setErr(null);
    api.vendors.me().then(setV).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  async function toggle() {
    if (!v) return;
    setBusy(true);
    setToggleErr(undefined);
    try {
      const r = await api.vendors.setOpen(!v.is_open);
      setV({ ...v, is_open: r.is_open, status_changed_at: r.status_changed_at });
    } catch (e) {
      setToggleErr(errorMessage(e, t)); // never show the new state unless the server confirmed it
    } finally {
      setBusy(false);
    }
  }

  if (err) return <Screen withNav><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!v) return <Loading label={t("common.loading")} />;

  return (
    <Screen withNav>
      <header className="v-head">
        <span className="v-head__avatar" aria-hidden="true"><Icon name="store" size={26} /></span>
        <div className="v-head__text">
          <p className="v-head__greeting">{t(greetingKey())}</p>
          <h1 className="vc-h2" style={{ fontSize: "var(--vc-text-xl)" }}>{v.shop_name}</h1>
          <span className="v-head__id">{v.vendor_id}</span>
        </div>
        <StatusBadge kind={v.verified ? "verified" : "unverified"} label={v.verified ? t("v.verified") : t("v.unverified")} size="sm" />
        <button className="vc-iconbtn" onClick={() => nav("/vendor/notifications")} aria-label={t("notif.title")}>
          <Icon name="bell" />
        </button>
      </header>
      {!online ? <OfflineBanner label={t("common.offline")} /> : null}

      <ShopStatusToggle
        isOpen={v.is_open}
        onToggle={toggle}
        busy={busy}
        labels={{ title: t("v.dash.status_title"), open: t("v.dash.open"), closed: t("v.dash.closed"), openAction: t("v.dash.open_action"), closeAction: t("v.dash.close_action") }}
      />
      {toggleErr ? <Banner tone="error" icon="alert">{toggleErr}</Banner> : null}

      {/* Products/low/out are real counts from GET /vendors/me/summary. There's no "Today's
       * orders"/"Sales" tile here — that data doesn't exist until the order system (Phase 8)
       * ships, and showing a hardcoded 0 in its place would be exactly the fabricated data this
       * project's brief forbids. The "Orders" quick action below already signposts that the
       * feature is coming, honestly (a "coming soon" placeholder), without faking a number. */}
      <section className="vc-stack" aria-labelledby="overview-h">
        <h2 id="overview-h" className="vc-h2">{t("v.dash.overview")}</h2>
        <div className="vc-grid-3">
          <div className="v-stat"><Icon name="box" size={20} /><b>{stats ? stats.product_count : "—"}</b><span>{t("v.dash.products")}</span></div>
          <div className="v-stat"><Icon name="alert" size={20} /><b>{stats ? stats.low_stock_count : "—"}</b><span>{t("v.dash.low")}</span></div>
          <div className="v-stat"><Icon name="x" size={20} /><b>{stats ? stats.out_of_stock_count : "—"}</b><span>{t("v.dash.out")}</span></div>
        </div>
      </section>

      <section className="vc-stack" aria-labelledby="qa-h">
        <h2 id="qa-h" className="vc-h2">{t("v.dash.quick")}</h2>
        <div className="vc-grid-3">
          <Tile icon="plus" label={t("v.qa.add")} onClick={() => nav("/vendor/products/new")} />
          <Tile icon="camera" label={t("v.qa.scan")} tone="orange" onClick={() => nav("/vendor/products/scan")} />
          <Tile icon="box" label={t("v.qa.stock")} onClick={() => nav("/vendor/products")} />
          <Tile icon="share" label={t("v.qa.post")} onClick={() => nav("/vendor/posts/new")} />
          <Tile icon="orders" label={t("v.qa.orders")} onClick={() => nav("/vendor/orders")} />
          <Tile icon="chat" label={t("v.qa.messages")} onClick={() => nav("/vendor/messages")} />
          <Tile icon="star" label={t("v.qa.reviews")} tone="orange" onClick={() => nav("/vendor/reviews")} />
        </div>
      </section>
    </Screen>
  );
}
