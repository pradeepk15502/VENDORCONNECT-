import type { ReviewCreateInput } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { Banner, Button } from "@vc/ui";
import { useState } from "react";
import { RatingInput } from "./RatingStars";

/** "Rate your experience" (master prompt §19) — shown once an order is completed. Optionally ties
 * the review to one of the order's own products; every other field the backend re-validates
 * against the real order, so nothing here needs to be trusted client-side. */
export function ReviewForm({
  vendorName,
  listingOptions,
  onSubmit,
}: {
  vendorName: string;
  listingOptions: { id: string; name: string }[];
  onSubmit: (input: ReviewCreateInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [listingId, setListingId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function submit() {
    if (rating < 1) {
      setErr(t("social.review.rating_required"));
      return;
    }
    setErr(undefined);
    setBusy(true);
    try {
      await onSubmit({ rating, text: text.trim() || undefined, listing_id: listingId || undefined });
    } catch {
      setErr(t("common.error_title"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="soc-reviewform vc-stack">
      <p className="vc-muted" style={{ margin: 0 }}>{t("social.review.prompt", { vendor: vendorName })}</p>
      <RatingInput value={rating} onChange={setRating} label={t("social.review.rating_label_input")} />
      {listingOptions.length > 0 ? (
        <div className="vc-field">
          <label htmlFor="review-listing" className="vc-field__label">{t("social.review.about_product")}</label>
          <div className="vc-field__control">
            <select id="review-listing" value={listingId} onChange={(e) => setListingId(e.target.value)} style={{ width: "100%", height: 48, border: 0, background: "transparent", padding: "0 12px" }}>
              <option value="">{t("social.review.about_shop_general")}</option>
              {listingOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        </div>
      ) : null}
      <div className="vc-field">
        <label htmlFor="review-text" className="vc-field__label">{t("social.review.write_label")}</label>
        <textarea
          id="review-text"
          className="soc-reviewform__textarea"
          maxLength={1000}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("social.review.write_ph")}
        />
      </div>
      {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
      <Button block size="lg" loading={busy} onClick={submit}>{t("social.review.submit")}</Button>
    </div>
  );
}
