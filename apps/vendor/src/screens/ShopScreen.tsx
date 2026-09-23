import { useSession, type VendorOwner } from "@vc/api-client";
import { LANGUAGES, useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, Card, Chip, ErrorState, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";

export function ShopScreen() {
  const { t, lang, setLang } = useI18n();
  const { api, logout } = useSession();
  const [v, setV] = useState<VendorOwner | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => {
    setErr(null);
    api.vendors.me().then(setV).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  if (err) return <Screen withNav><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} /></Screen>;
  if (!v) return <Loading label={t("common.loading")} />;
  const d = v.delivery;
  return (
    <Screen withNav>
      <AppBar title={t("nav.shop")} />
      <Card className="vc-stack">
        <h2 className="vc-h2">{v.shop_name}</h2>
        <dl className="v-kv">
          <dt>ID</dt><dd>{v.vendor_id}</dd>
          <dt>📍</dt><dd>{[v.location?.address_line, v.location?.city].filter(Boolean).join(", ")}</dd>
          <dt>📞</dt><dd>{v.public_phone}</dd>
        </dl>
        <div className="vc-row">
          {d.delivery_enabled ? <StatusBadge kind="delivery" label={t("v.delivery_on")} /> : <StatusBadge kind="pickup_only" label={t("v.pickup_only")} />}
        </div>
      </Card>
      <Card className="vc-stack">
        <h2 className="vc-h2">{t("profile.language")}</h2>
        <div className="vc-row">
          {LANGUAGES.map((l) => <Chip key={l.code} selected={lang === l.code} onClick={() => { setLang(l.code); api.auth.updateMe({ language: l.code }).catch(() => undefined); }}>{l.native}</Chip>)}
        </div>
      </Card>
      <Button variant="secondary" block icon="logout" onClick={() => logout()}>{t("auth.logout")}</Button>
    </Screen>
  );
}
