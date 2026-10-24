import {
  ApiError,
  UNITS,
  useSession,
  type Availability,
  type AIDetection,
  type AIPrediction,
  type Category,
  type Unit,
} from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Chip, ErrorState, Screen, Skeleton, TextField } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatUnit } from "../../shared/units";

/* Confirmation screen for one AI scan (Phase 10, master prompt §16/§17/§20/§33). Every field here
 * is editable and starts from the AI's suggestion at best — never from a fabricated one: a "failed"
 * or empty-prediction detection shows no form at all, only [Scan Again] / [Add manually], and a
 * price suggestion is shown purely as an advisory range (never pre-filled into the price field —
 * "vendor-entered price remains authoritative," §15). The only call that ever creates a listing is
 * the explicit "Add Product" button, via the same `VendorProductCreateSerializer` manual entry uses
 * — this screen never auto-publishes anything on its own. */

type Form = {
  category: string;
  name: string;
  description: string;
  price: string;
  mrp: string;
  unit: Unit;
  unit_quantity: string;
  quantity: string;
  low_stock_threshold: string;
  availability: Availability;
};

const EMPTY: Form = {
  category: "",
  name: "",
  description: "",
  price: "",
  mrp: "",
  unit: "piece",
  unit_quantity: "1",
  quantity: "",
  low_stock_threshold: "",
  availability: "in_stock",
};

const AVAILABILITY_ORDER: Availability[] = ["in_stock", "low_stock", "out_of_stock"];

function formFromPrediction(p: AIPrediction | null): Form {
  if (!p) return EMPTY;
  return { ...EMPTY, category: p.category_slug ?? "", name: p.label, unit: (p.unit as Unit | null) ?? "piece" };
}

export function VendorScanConfirmScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [cats, setCats] = useState<Category[] | null>(null);
  const [detection, setDetection] = useState<AIDetection | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [selected, setSelected] = useState<number | null>(0); // index into predictions; null = "something else"
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showConfidence, setShowConfidence] = useState(false);

  useEffect(() => {
    api.catalog.categories().then(setCats).catch(() => undefined);
  }, [api]);

  const load = useCallback(() => {
    if (!id) return;
    setLoadErr(null);
    api.ai
      .get(id)
      .then((d) => {
        setDetection(d);
        const top = d.predictions[0] ?? null;
        setSelected(top ? 0 : null);
        setF(formFromPrediction(top));
      })
      .catch(setLoadErr);
  }, [api, id]);
  useEffect(load, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  function pick(index: number | null) {
    setSelected(index);
    setF(formFromPrediction(index !== null ? (detection?.predictions[index] ?? null) : null));
    setErrors({});
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!f.category) e.category = t("v.pform.category_required");
    if (!f.name.trim()) e.name = t("v.pform.name_required");
    if (f.price.trim() === "" || Number(f.price) < 0) e.price = t("v.pform.price_required");
    if (f.mrp.trim() !== "" && Number(f.mrp) < Number(f.price || 0)) e.mrp = t("v.pform.mrp_low");
    return e;
  }

  function fieldErrorFrom(err: unknown, ...fields: string[]): string {
    if (err instanceof ApiError && err.code === "validation_error") {
      for (const field of fields) {
        const msg = err.field(field);
        if (msg) return msg;
      }
      return err.message;
    }
    return errorMessage(err, t);
  }

  async function confirm() {
    if (!id) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormErr(undefined);
    const top = selected !== null ? (detection?.predictions[selected] ?? null) : null;
    try {
      const created = await api.ai.confirm(id, {
        category: f.category,
        product: top?.product_slug ?? undefined,
        variety: top?.variety_id ?? undefined,
        name: f.name.trim(),
        description: f.description.trim() || undefined,
        price: f.price,
        mrp: f.mrp.trim() || undefined,
        unit: f.unit,
        unit_quantity: f.unit_quantity.trim() || "1",
        quantity: f.quantity.trim() || undefined,
        low_stock_threshold: f.low_stock_threshold.trim() || undefined,
        availability: f.availability,
      });
      nav(`/vendor/products/${created.id}/edit`, { replace: true });
    } catch (err) {
      setFormErr(fieldErrorFrom(err, "category", "product", "variety", "name", "price", "mrp", "unit"));
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) {
    return (
      <Screen>
        <AppBar title={t("v.scanr.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
        <ErrorState title={t("common.error_title")} message={t("v.scanr.load_error")} onRetry={load} retryLabel={t("common.retry")} />
      </Screen>
    );
  }
  if (!detection) {
    return (
      <Screen>
        <AppBar title={t("v.scanr.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
        <Skeleton lines={6} />
      </Screen>
    );
  }

  const noResult = detection.status === "failed" || detection.predictions.length === 0;
  const top = selected !== null ? (detection.predictions[selected] ?? null) : null;
  const existingListing = detection.existing_listing;
  const suggestedPrice = detection.suggested_price;

  return (
    <Screen>
      <AppBar title={t("v.scanr.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      <div className="vc-stack v-scanr">
        {detection.image_url ? <img src={detection.image_url} alt="" className="v-scanr__preview" /> : null}

        <Banner tone={noResult ? "warn" : "success"} icon={noResult ? "alert" : "check"}>
          {detection.message}
        </Banner>

        {noResult ? (
          <>
            <Button size="lg" block onClick={() => nav("/vendor/products/scan")}>
              {t("v.scanr.scan_again")}
            </Button>
            <Button size="lg" variant="secondary" block onClick={() => nav("/vendor/products/new")}>
              {t("v.scanr.add_manually")}
            </Button>
          </>
        ) : (
          <>
            {detection.predictions.length > 1 ? (
              <div>
                <p className="vc-field__label">{t("v.scanr.not_this")}</p>
                <div className="vc-row" role="group" aria-label={t("v.scanr.not_this")}>
                  {detection.predictions.map((p, i) => (
                    <Chip key={`${p.product_slug ?? "x"}-${p.variety_id ?? "x"}-${i}`} selected={selected === i} onClick={() => pick(i)}>
                      {p.label}
                    </Chip>
                  ))}
                  <Chip selected={selected === null} onClick={() => pick(null)}>
                    {t("v.scanr.something_else")}
                  </Chip>
                </div>
              </div>
            ) : null}

            {top ? (
              <div className="v-scanr__match">
                <span className={`v-scanr__band v-scanr__band--${top.band}`}>
                  {t(top.band === "likely" ? "v.scanr.band.likely" : "v.scanr.band.possible")}
                </span>
                <span className="v-scanr__source">{t(top.source === "barcode" ? "v.scanr.via_barcode" : "v.scanr.via_ocr")}</span>
                <Button variant="ghost" onClick={() => setShowConfidence((s) => !s)}>
                  {t("v.scanr.confidence_toggle")}
                </Button>
                {showConfidence ? (
                  <p className="v-scanr__confidence">{t("v.scanr.confidence_value", { pct: Math.round(top.confidence * 100) })}</p>
                ) : null}
              </div>
            ) : null}

            {detection.provider?.is_development ? <p className="v-scanr__dev">{t("v.scanr.dev_provider")}</p> : null}

            {existingListing ? (
              <Banner tone="info" icon="box">
                {t("v.scanr.existing_listing", { name: existingListing.name })}{" "}
                <Button variant="ghost" onClick={() => nav(`/vendor/products/${existingListing.id}/edit`)}>
                  {t("v.scanr.view_existing")}
                </Button>
              </Banner>
            ) : null}

            {suggestedPrice ? (
              <Banner tone="info">
                {t("v.scanr.price_suggested", {
                  min: suggestedPrice.min,
                  max: suggestedPrice.max,
                  unit: suggestedPrice.unit,
                  region: suggestedPrice.region,
                  source: suggestedPrice.source,
                  date: suggestedPrice.observed_at.slice(0, 10),
                })}
              </Banner>
            ) : (
              <Banner tone="info">{t("v.scanr.price_unavailable")}</Banner>
            )}

            <TextField label={t("v.pform.name")} value={f.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={120} name="name" />

            <div>
              <p className="vc-field__label">{t("v.pform.category")}</p>
              {cats === null ? (
                <Skeleton />
              ) : (
                <div className="vc-row" role="group" aria-label={t("v.pform.category")}>
                  {cats.map((c) => (
                    <Chip key={c.slug} icon={c.icon} selected={f.category === c.slug} onClick={() => set("category", c.slug)}>
                      {c.names_i18n[lang] ?? c.name}
                    </Chip>
                  ))}
                </div>
              )}
              {errors.category ? (
                <Banner tone="error" icon="alert">
                  {errors.category}
                </Banner>
              ) : null}
            </div>

            <TextField label={t("v.pform.description")} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} name="description" />

            <div className="v-pform__row2">
              <TextField
                label={t("v.pform.price")}
                prefix="₹"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={f.price}
                onChange={(e) => set("price", e.target.value)}
                error={errors.price}
                name="price"
                autoFocus
              />
              <TextField
                label={t("v.pform.mrp")}
                prefix="₹"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={f.mrp}
                onChange={(e) => set("mrp", e.target.value)}
                error={errors.mrp}
                hint={errors.mrp ? undefined : t("v.pform.mrp_hint")}
                name="mrp"
              />
            </div>

            <div>
              <p className="vc-field__label">{t("v.pform.unit")}</p>
              <div className="vc-row v-pform__unit-row" role="group" aria-label={t("v.pform.unit")}>
                {UNITS.map((u) => (
                  <Chip key={u} selected={f.unit === u} onClick={() => set("unit", u)}>
                    {formatUnit(t, u, "1")}
                  </Chip>
                ))}
              </div>
            </div>

            <TextField
              label={t("v.pform.unit_quantity")}
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              value={f.unit_quantity}
              onChange={(e) => set("unit_quantity", e.target.value)}
              hint={t("v.pform.unit_quantity_hint")}
              name="unit_quantity"
            />

            <div>
              <p className="vc-field__label">{t("v.pform.availability")}</p>
              <div className="vc-row" role="group" aria-label={t("v.pform.availability")}>
                {AVAILABILITY_ORDER.map((a) => (
                  <Chip key={a} selected={f.availability === a} onClick={() => set("availability", a)}>
                    {t(`avail.${a}` as MessageKey)}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="v-pform__row2">
              <TextField
                label={t("v.pform.quantity")}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={f.quantity}
                onChange={(e) => set("quantity", e.target.value)}
                hint={t("v.pform.quantity_hint")}
                name="quantity"
              />
              <TextField
                label={t("v.pform.low_stock_threshold")}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={f.low_stock_threshold}
                onChange={(e) => set("low_stock_threshold", e.target.value)}
                name="low_stock_threshold"
              />
            </div>

            {formErr ? (
              <Banner tone="error" icon="alert">
                {formErr}
              </Banner>
            ) : null}

            <Button size="lg" block loading={busy} onClick={confirm}>
              {t("v.scanr.add_product")}
            </Button>
            <Button variant="secondary" block onClick={() => nav("/vendor/products/scan")}>
              {t("v.scanr.scan_again")}
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
