import { ApiError, useSession, type VendorOwner } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Loading, Screen, TextField } from "@vc/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type Form = {
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  radius_km: string;
  delivery_fee: string;
  min_order_amount: string;
  free_delivery_above: string;
};

export function DeliverySettingsScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState<Form | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [saveErr, setSaveErr] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.vendors.me().then((v: VendorOwner) => {
      setF({
        delivery_enabled: v.delivery.delivery_enabled,
        pickup_enabled: v.delivery.pickup_enabled,
        radius_km: v.delivery.radius_km,
        delivery_fee: v.delivery.delivery_fee,
        min_order_amount: v.delivery.min_order_amount,
        free_delivery_above: v.delivery.free_delivery_above ?? "",
      });
    }).catch(setLoadErr);
  }, [api]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => (p ? { ...p, [k]: v } : p)); setSaved(false); };

  async function save() {
    if (!f) return;
    setBusy(true);
    setSaveErr(undefined);
    try {
      await api.vendors.updateDelivery({
        delivery_enabled: f.delivery_enabled,
        pickup_enabled: f.pickup_enabled,
        radius_km: f.radius_km,
        delivery_fee: f.delivery_fee,
        min_order_amount: f.min_order_amount,
        free_delivery_above: f.free_delivery_above === "" ? null : f.free_delivery_above,
      });
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "validation_error") setSaveErr(e.message);
      else setSaveErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) return <Screen><AppBar title={t("v.delivery.title")} onBack={() => nav(-1)} backLabel={t("common.back")} /><Banner tone="error" icon="alert">{errorMessage(loadErr, t)}</Banner></Screen>;
  if (!f) return <Loading label={t("common.loading")} />;

  return (
    <Screen>
      <AppBar title={t("v.delivery.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      <div className="vc-stack">
        <label className="vc-row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={f.pickup_enabled} onChange={(e) => set("pickup_enabled", e.target.checked)} />
          {t("v.delivery.pickup_enabled")}
        </label>
        <label className="vc-row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={f.delivery_enabled} onChange={(e) => set("delivery_enabled", e.target.checked)} />
          {t("v.delivery.enabled")}
        </label>

        {f.delivery_enabled ? (
          <>
            <TextField label={t("v.delivery.radius")} type="number" inputMode="decimal" min={0.5} max={25} step="0.5" value={f.radius_km} onChange={(e) => set("radius_km", e.target.value)} />
            <TextField label={t("v.delivery.fee")} prefix="₹" type="number" inputMode="decimal" min={0} step="0.01" value={f.delivery_fee} onChange={(e) => set("delivery_fee", e.target.value)} />
            <TextField label={t("v.delivery.min_order")} prefix="₹" type="number" inputMode="decimal" min={0} step="0.01" value={f.min_order_amount} onChange={(e) => set("min_order_amount", e.target.value)} />
            <TextField label={t("v.delivery.free_above")} prefix="₹" type="number" inputMode="decimal" min={0} step="0.01" value={f.free_delivery_above} onChange={(e) => set("free_delivery_above", e.target.value)} />
          </>
        ) : null}

        {saveErr ? <Banner tone="error" icon="alert">{saveErr}</Banner> : null}
        {saved ? <Banner tone="success" icon="check">{t("v.delivery.saved")}</Banner> : null}
        <Button size="lg" block onClick={save} loading={busy}>{t("common.save")}</Button>
      </div>
    </Screen>
  );
}
