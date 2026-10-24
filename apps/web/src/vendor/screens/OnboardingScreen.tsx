import { ApiError, useSession, type Category } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Chip, ErrorState, Screen, Skeleton, TextField } from "@vc/ui";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

type Form = {
  shop_name: string;
  categories: string[];
  lat?: number;
  lng?: number;
  address_line: string;
  landmark: string;
  city: string;
  pincode: string;
  public_phone: string;
};

const TOTAL = 3;

export function OnboardingScreen({ onCreated }: { onCreated: () => void }) {
  const { t, lang } = useI18n();
  const { api, reloadMe, me } = useSession();
  // Decided once on arrival: a vendor who already has a shop skips setup. Must not re-evaluate after
  // creation, or the session refresh would bypass the Vendor ID screen.
  const [hadShopOnArrival] = useState(() => !!me?.vendor);
  const [step, setStep] = useState(1);
  const [cats, setCats] = useState<Category[] | null>(null);
  const [catErr, setCatErr] = useState<unknown>(null);
  const [f, setF] = useState<Form>({ shop_name: "", categories: [], address_line: "", landmark: "", city: "", pincode: "", public_phone: me?.phone.slice(3) ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [formErr, setFormErr] = useState<string>();

  const loadCats = () => {
    setCatErr(null);
    api.catalog.categories().then(setCats).catch(setCatErr);
  };
  useEffect(loadCats, [api]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  function next() {
    const e: Record<string, string> = {};
    if (step === 1 && f.shop_name.trim().length < 2) e.shop_name = t("v.onb.shop_name");
    if (step === 2 && f.categories.length === 0) e.categories = t("v.onb.categories_hint");
    setErrors(e);
    if (Object.keys(e).length === 0) setStep(step + 1);
  }

  function captureGps() {
    if (!("geolocation" in navigator)) return setFormErr(t("loc.unavailable"));
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setF((s) => ({ ...s, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }));
        setFormErr(undefined);
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
    if (f.lat === undefined) e.location = t("v.onb.need_location");
    if (!f.address_line.trim()) e.address_line = t("v.onb.address");
    if (!f.city.trim()) e.city = t("v.onb.city");
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormErr(undefined);
    try {
      await api.vendors.create({
        shop_name: f.shop_name.trim(),
        category_slugs: f.categories,
        public_phone: f.public_phone || undefined,
        location: { lat: f.lat!, lng: f.lng!, address_line: f.address_line.trim(), landmark: f.landmark.trim(), city: f.city.trim(), pincode: f.pincode.trim() },
      });
      await reloadMe();
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_error") {
        setFormErr(err.field("location") ?? err.field("shop_name") ?? err.field("public_phone") ?? err.message);
      } else setFormErr(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (hadShopOnArrival) return <Navigate to="/vendor" replace />;

  return (
    <Screen>
      <AppBar title={t("v.onb.title")} onBack={step > 1 ? () => setStep(step - 1) : undefined} backLabel={t("common.back")} />
      <p className="vc-muted" style={{ margin: 0 }}>{t("v.onb.step", { n: step, total: TOTAL })}</p>
      <div className="v-progress" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={step}><span style={{ width: `${(step / TOTAL) * 100}%` }} /></div>

      {step === 1 && (
        <div className="vc-stack">
          <TextField label={t("v.onb.shop_name")} placeholder={t("v.onb.shop_name_ph")} value={f.shop_name} onChange={(e) => set("shop_name", e.target.value)} error={errors.shop_name} maxLength={120} autoFocus name="shop_name" />
          <TextField label={t("v.onb.phone")} prefix="+91" type="tel" inputMode="numeric" value={f.public_phone} onChange={(e) => set("public_phone", e.target.value)} maxLength={10} name="public_phone" />
          <Button size="lg" block onClick={next}>{t("common.next")}</Button>
        </div>
      )}

      {step === 2 && (
        <div className="vc-stack">
          <h2 className="vc-h2">{t("v.onb.categories")}</h2>
          <p className="vc-muted" style={{ margin: 0 }}>{t("v.onb.categories_hint")}</p>
          {catErr ? <ErrorState title={t("common.error_title")} message={errorMessage(catErr, t)} onRetry={loadCats} retryLabel={t("common.retry")} /> : cats === null ? <Skeleton /> : (
            <div className="vc-row" role="group" aria-label={t("v.onb.categories")}>
              {cats.map((c) => {
                const sel = f.categories.includes(c.slug);
                return (
                  <Chip key={c.slug} icon={c.icon} selected={sel} onClick={() => set("categories", sel ? f.categories.filter((x) => x !== c.slug) : f.categories.length < 5 ? [...f.categories, c.slug] : f.categories)}>
                    {c.names_i18n[lang] ?? c.name}
                  </Chip>
                );
              })}
            </div>
          )}
          {errors.categories ? <Banner tone="error" icon="alert">{errors.categories}</Banner> : null}
          <Button size="lg" block onClick={next}>{t("common.next")}</Button>
        </div>
      )}

      {step === 3 && (
        <div className="vc-stack">
          <h2 className="vc-h2">{t("v.onb.location")}</h2>
          <Button size="lg" block variant={f.lat === undefined ? "primary" : "secondary"} icon="pin" onClick={captureGps} loading={gpsBusy}>
            {f.lat === undefined ? t("v.onb.use_gps") : t("v.onb.gps_ok")}
          </Button>
          {f.lat !== undefined ? <p className="vc-muted" style={{ margin: 0 }} data-testid="coords">{f.lat}, {f.lng}</p> : null}
          {errors.location ? <Banner tone="error" icon="alert">{errors.location}</Banner> : null}
          <TextField label={t("v.onb.address")} value={f.address_line} onChange={(e) => set("address_line", e.target.value)} error={errors.address_line} maxLength={250} name="address_line" />
          <TextField label={t("v.onb.landmark")} value={f.landmark} onChange={(e) => set("landmark", e.target.value)} maxLength={120} name="landmark" />
          <div className="vc-grid-2">
            <TextField label={t("v.onb.city")} value={f.city} onChange={(e) => set("city", e.target.value)} error={errors.city} maxLength={80} name="city" />
            <TextField label={t("v.onb.pincode")} inputMode="numeric" value={f.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} name="pincode" />
          </div>
          {formErr ? <Banner tone="error" icon="alert">{formErr}</Banner> : null}
          <Button size="lg" block onClick={submit} loading={busy}>{t("v.onb.create")}</Button>
        </div>
      )}
    </Screen>
  );
}
