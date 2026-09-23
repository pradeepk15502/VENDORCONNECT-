import { useOnline, useSession, type VendorOwner } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { Banner, ErrorState, Loading, OfflineBanner, Screen, ShopStatusToggle, StatusBadge, Tile } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function DashboardScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const online = useOnline();
  const nav = useNavigate();
  const [v, setV] = useState<VendorOwner | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [toggleErr, setToggleErr] = useState<string>();

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
        <div style={{ flex: 1 }}>
          <h1 className="vc-h2" style={{ fontSize: "var(--vc-text-xl)" }}>{v.shop_name}</h1>
          <span className="v-head__id">{v.vendor_id}</span>
        </div>
        <StatusBadge kind={v.verified ? "verified" : "unverified"} label={v.verified ? t("v.verified") : t("v.unverified")} size="sm" />
      </header>
      {!online ? <OfflineBanner label={t("common.offline")} /> : null}

      <ShopStatusToggle
        isOpen={v.is_open}
        onToggle={toggle}
        busy={busy}
        labels={{ title: t("v.dash.status_title"), open: t("v.dash.open"), closed: t("v.dash.closed"), openAction: t("v.dash.open_action"), closeAction: t("v.dash.close_action") }}
      />
      {toggleErr ? <Banner tone="error" icon="alert">{toggleErr}</Banner> : null}

      <section className="vc-stack" aria-labelledby="today-h">
        <h2 id="today-h" className="vc-h2">{t("v.dash.today")}</h2>
        <div className="vc-grid-3">
          <div className="v-stat"><b>0</b><span>{t("v.dash.orders")}</span></div>
          <div className="v-stat"><b>₹0</b><span>{t("v.dash.sales")}</span></div>
          <div className="v-stat"><b>0</b><span>{t("v.dash.products")}</span></div>
          <div className="v-stat"><b>0</b><span>{t("v.dash.low")}</span></div>
          <div className="v-stat"><b>0</b><span>{t("v.dash.out")}</span></div>
        </div>
      </section>

      <section className="vc-stack" aria-labelledby="qa-h">
        <h2 id="qa-h" className="vc-h2">{t("v.dash.quick")}</h2>
        <div className="vc-grid-3">
          <Tile icon="plus" label={t("v.qa.add")} onClick={() => nav("/products")} />
          <Tile icon="camera" label={t("v.qa.scan")} tone="orange" onClick={() => nav("/products")} />
          <Tile icon="box" label={t("v.qa.stock")} onClick={() => nav("/products")} />
          <Tile icon="share" label={t("v.qa.post")} onClick={() => nav("/shop")} />
          <Tile icon="orders" label={t("v.qa.orders")} onClick={() => nav("/orders")} />
          <Tile icon="chat" label={t("v.qa.messages")} onClick={() => nav("/messages")} />
        </div>
      </section>
    </Screen>
  );
}
