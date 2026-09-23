import { ApiError, useSession, type VendorPublic } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, Card, EmptyState, ErrorState, Icon, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

/* Deep link target: /v/SHARMA001 or /v/@sharma001. Phase 3 adds tabs (Posts · Products · Reviews · About). */
export function VendorProfileScreen() {
  const { handle = "" } = useParams();
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [v, setV] = useState<VendorPublic | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null);
    setV(null);
    api.vendors.byHandle(handle).then(setV).catch(setErr);
  }, [api, handle]);
  useEffect(load, [load]);

  const back = () => (window.history.length > 1 ? nav(-1) : nav("/"));

  if (err instanceof ApiError && err.status === 404)
    return <Screen><AppBar title="" onBack={back} /><EmptyState icon="store" title={t("vendors.empty")} message={`@${handle.replace(/^@/, "").toUpperCase()}`} /></Screen>;
  if (err) return <Screen><AppBar title="" onBack={back} /><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!v) return <Loading label={t("common.loading")} />;

  const loc = v.location;
  const directions = loc ? `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}` : undefined;
  return (
    <Screen>
      <AppBar title={v.vendor_id} onBack={back} backLabel={t("common.back")} />
      <Card className="vc-stack">
        <div className="vc-row">
          <span className="vc-brand__mark" aria-hidden="true"><Icon name="store" size={32} /></span>
          <div style={{ flex: 1 }}>
            <h1 className="vc-h2" style={{ fontSize: "var(--vc-text-xl)" }} data-testid="vendor-name">{v.shop_name}</h1>
            <span className="vc-muted">{v.vendor_id}</span>
          </div>
        </div>
        <div className="vc-row">
          <StatusBadge kind={v.is_open ? "open" : "closed"} label={v.is_open ? t("status.open") : t("status.closed")} size="lg" />
          {v.verified ? <StatusBadge kind="verified" label={t("v.verified")} /> : null}
          {v.delivery.delivery_enabled ? <StatusBadge kind="delivery" label={t("v.delivery_on")} /> : <StatusBadge kind="pickup_only" label={t("v.pickup_only")} />}
        </div>
        {loc ? <p style={{ margin: 0 }}><Icon name="pin" size={18} /> {[loc.address_line, loc.landmark, loc.city].filter(Boolean).join(", ")}</p> : null}
      </Card>
      <div className="vc-grid-2">
        <a className="vc-btn vc-btn--primary vc-btn--lg" href={`tel:${v.public_phone}`}><Icon name="phone" /> <span>Call</span></a>
        {directions ? <a className="vc-btn vc-btn--secondary vc-btn--lg" href={directions} target="_blank" rel="noopener noreferrer"><Icon name="directions" /> <span>Directions</span></a> : null}
      </div>
      <Button variant="ghost" onClick={() => nav("/")}>{t("nav.home")}</Button>
    </Screen>
  );
}
