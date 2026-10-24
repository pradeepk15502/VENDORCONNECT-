import { ApiError, UNITS, useSession, type Availability, type Category, type Unit, type VendorProductItem } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Chip, ErrorState, Modal, Screen, Skeleton, TextField } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatUnit } from "../../shared/units";

/* Create/edit a listing (Phase 4). `product`/`variety` (the shared catalog link — ARCHITECTURE D8)
 * are deliberately not exposed here: a vendor always names their own listing; linking it to the
 * shared Product catalog is a picker UI left for later, not required for a listing to be complete
 * or findable (listing.name has its own trigram search index for exactly this case). */

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

function toForm(item: VendorProductItem): Form {
  return {
    category: item.category,
    name: item.name,
    description: item.description,
    price: item.price,
    mrp: item.mrp ?? "",
    unit: item.unit,
    unit_quantity: item.unit_quantity,
    quantity: item.quantity ?? "",
    low_stock_threshold: item.low_stock_threshold ?? "",
    availability: item.availability,
  };
}

export function VendorProductFormScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editing = !!id;

  const [cats, setCats] = useState<Category[] | null>(null);
  const [original, setOriginal] = useState<VendorProductItem | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.catalog.categories().then(setCats).catch(() => undefined);
  }, [api]);

  const load = useCallback(() => {
    if (!id) return;
    setLoadErr(null);
    api.vendorProducts
      .get(id)
      .then((item) => {
        setOriginal(item);
        setF(toForm(item));
      })
      .catch(setLoadErr);
  }, [api, id]);
  useEffect(load, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

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

  async function submitCreate() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormErr(undefined);
    try {
      const created = await api.vendorProducts.create({
        category: f.category,
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

  async function submitEdit() {
    if (!original) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormErr(undefined);
    try {
      const patch: Record<string, unknown> = {};
      if (f.category !== original.category) patch.category = f.category;
      const name = f.name.trim();
      if (name !== original.name) patch.name = name;
      const description = f.description.trim();
      if (description !== original.description) patch.description = description;
      if (f.unit !== original.unit) patch.unit = f.unit;
      const unitQuantity = f.unit_quantity.trim() || "1";
      if (unitQuantity !== original.unit_quantity) patch.unit_quantity = unitQuantity;
      const mrp = f.mrp.trim();
      if (mrp !== (original.mrp ?? "")) patch.mrp = mrp || null;
      const threshold = f.low_stock_threshold.trim();
      if (threshold !== (original.low_stock_threshold ?? "")) patch.low_stock_threshold = threshold || null;

      let latest = original;
      if (Object.keys(patch).length > 0) latest = await api.vendorProducts.update(original.id, patch);
      if (f.price !== original.price) latest = await api.prices.update({ listing_id: original.id, price: f.price });

      const quantity = f.quantity.trim();
      if (f.availability !== original.availability || quantity !== (original.quantity ?? "")) {
        latest = await api.inventory.update({
          listing_id: original.id,
          availability: f.availability,
          quantity: quantity ? Number(quantity) : null,
        });
      }
      setOriginal(latest);
      setF(toForm(latest));
      nav("/vendor/products");
    } catch (err) {
      setFormErr(fieldErrorFrom(err, "category", "name", "mrp", "price", "availability", "quantity"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setDeleteBusy(true);
    setFormErr(undefined);
    try {
      await api.vendorProducts.remove(id);
      nav("/vendor/products", { replace: true });
    } catch (err) {
      setConfirmDelete(false);
      setFormErr(errorMessage(err, t));
      setDeleteBusy(false);
    }
  }

  if (editing && loadErr) {
    return (
      <Screen>
        <ErrorState title={t("common.error_title")} message={errorMessage(loadErr, t)} onRetry={load} retryLabel={t("common.retry")} />
      </Screen>
    );
  }
  if (editing && !original) {
    return (
      <Screen>
        <Skeleton lines={6} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar title={editing ? t("v.pform.edit_title") : t("v.pform.add_title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      <div className="vc-stack">
        <TextField label={t("v.pform.name")} value={f.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={120} autoFocus name="name" />

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
          {errors.category ? <Banner tone="error" icon="alert">{errors.category}</Banner> : null}
        </div>

        <TextField label={t("v.pform.description")} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} name="description" />

        <div className="v-pform__row2">
          <TextField label={t("v.pform.price")} prefix="₹" type="number" inputMode="decimal" min={0} step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} error={errors.price} name="price" />
          <TextField label={t("v.pform.mrp")} prefix="₹" type="number" inputMode="decimal" min={0} step="0.01" value={f.mrp} onChange={(e) => set("mrp", e.target.value)} error={errors.mrp} hint={errors.mrp ? undefined : t("v.pform.mrp_hint")} name="mrp" />
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

        <TextField label={t("v.pform.unit_quantity")} type="number" inputMode="decimal" min={0.01} step="0.01" value={f.unit_quantity} onChange={(e) => set("unit_quantity", e.target.value)} hint={t("v.pform.unit_quantity_hint")} name="unit_quantity" />

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
          <TextField label={t("v.pform.quantity")} type="number" inputMode="decimal" min={0} step="0.01" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} hint={t("v.pform.quantity_hint")} name="quantity" />
          <TextField label={t("v.pform.low_stock_threshold")} type="number" inputMode="decimal" min={0} step="0.01" value={f.low_stock_threshold} onChange={(e) => set("low_stock_threshold", e.target.value)} name="low_stock_threshold" />
        </div>

        {formErr ? <Banner tone="error" icon="alert">{formErr}</Banner> : null}

        <Button size="lg" block loading={busy} onClick={editing ? submitEdit : submitCreate}>
          {editing ? t("common.save") : t("v.pform.create")}
        </Button>

        {editing ? (
          <Button variant="danger" block onClick={() => setConfirmDelete(true)}>
            {t("v.pform.delete")}
          </Button>
        ) : null}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("v.pform.delete_confirm_title")} closeLabel={t("common.close")}>
        <p>{t("v.pform.delete_confirm_body")}</p>
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t("common.back")}</Button>
          <Button variant="danger" loading={deleteBusy} onClick={remove}>{t("v.pform.delete")}</Button>
        </div>
      </Modal>
    </Screen>
  );
}
