import { ApiError, useSession, type AddressItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Loading, Screen, TextField } from "@vc/ui";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

type Form = {
  label: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  lat?: number;
  lng?: number;
  is_default: boolean;
};

const EMPTY: Form = { label: "", line1: "", line2: "", landmark: "", city: "", state: "", pincode: "", is_default: false };

export function AddressFormScreen() {
  const { addressId } = useParams();
  const isEdit = !!addressId;
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  useEffect(() => {
    if (!addressId) return;
    setLoading(true);
    api.addresses.get(addressId).then((a: AddressItem) => {
      setF({ label: a.label, line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, state: a.state, pincode: a.pincode, lat: a.lat ?? undefined, lng: a.lng ?? undefined, is_default: a.is_default });
      setLoading(false);
    }).catch((e) => { setLoadErr(e); setLoading(false); });
  }, [api, addressId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  function captureGps() {
    if (!("geolocation" in navigator)) return setFormErr(t("loc.unavailable"));
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setF((s) => ({ ...s, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }));
        setGpsBusy(false);
      },
      (e) => {
        setFormErr(t(e.code === e.PERMISSION_DENIED ? "loc.denied" : "loc.unavailable"));
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit() {
    const e: Record<string, string> = {};
    if (!f.line1.trim()) e.line1 = t("addr.line1_required");
    if (!f.city.trim()) e.city = t("addr.city_required");
    if (!f.pincode.trim()) e.pincode = t("addr.pincode_required");
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormErr(undefined);
    const payload = {
      // Unlike line2/landmark/state, the backend's `label` column has no blank default at the model
      // level — it only falls back to "Home" when the field is left out of the request entirely, so
      // an empty label is omitted here rather than sent as "" (which the server would reject).
      label: f.label.trim() || undefined, line1: f.line1.trim(), line2: f.line2.trim(), landmark: f.landmark.trim(),
      city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim(), lat: f.lat ?? null, lng: f.lng ?? null,
      is_default: f.is_default,
    };
    try {
      if (isEdit) await api.addresses.update(addressId, payload);
      else await api.addresses.create(payload);
      nav(-1);
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_error") {
        setFormErr(err.field("label") ?? err.field("line1") ?? err.field("city") ?? err.field("pincode") ?? err.message);
      } else setFormErr(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) return <Screen><AppBar title={t("addr.edit")} onBack={() => nav(-1)} backLabel={t("common.back")} /><Banner tone="error" icon="alert">{errorMessage(loadErr, t)}</Banner></Screen>;
  if (loading) return <Loading label={t("common.loading")} />;

  return (
    <Screen>
      <AppBar title={isEdit ? t("addr.edit") : t("addr.add")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      <div className="vc-stack">
        <TextField label={t("addr.label")} value={f.label} onChange={(e) => set("label", e.target.value)} maxLength={40} name="label" autoFocus />
        <Button size="lg" block variant={f.lat === undefined ? "primary" : "secondary"} icon="pin" onClick={captureGps} loading={gpsBusy}>
          {f.lat === undefined ? t("addr.use_gps") : t("addr.gps_ok")}
        </Button>
        <TextField label={t("addr.line1")} value={f.line1} onChange={(e) => set("line1", e.target.value)} error={errors.line1} maxLength={200} name="line1" />
        <TextField label={t("addr.line2")} value={f.line2} onChange={(e) => set("line2", e.target.value)} maxLength={200} name="line2" />
        <TextField label={t("addr.landmark")} value={f.landmark} onChange={(e) => set("landmark", e.target.value)} maxLength={120} name="landmark" />
        <div className="vc-grid-2">
          <TextField label={t("addr.city")} value={f.city} onChange={(e) => set("city", e.target.value)} error={errors.city} maxLength={80} name="city" />
          <TextField label={t("addr.pincode")} inputMode="numeric" value={f.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} error={errors.pincode} name="pincode" />
        </div>
        <TextField label={t("addr.state")} value={f.state} onChange={(e) => set("state", e.target.value)} maxLength={80} name="state" />
        <label className="vc-row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={f.is_default} onChange={(e) => set("is_default", e.target.checked)} />
          {t("addr.set_default")}
        </label>
        {formErr ? <Banner tone="error" icon="alert">{formErr}</Banner> : null}
        <Button size="lg" block onClick={submit} loading={busy}>{t("common.save")}</Button>
      </div>
    </Screen>
  );
}
