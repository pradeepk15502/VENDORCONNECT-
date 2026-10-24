import { useI18n } from "@vc/i18n";
import { Banner, Button, Modal } from "@vc/ui";
import { useState } from "react";

/** Shared report flow for posts and reviews (master prompt §27) — the reason list is the only
 * thing that differs between the two, passed in by the caller. */
export function ReportDialog({
  open,
  onClose,
  title,
  reasons,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  reasons: { value: string; label: string }[];
  onSubmit: (reason: string, details: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(false);

  function reset() {
    setReason("");
    setDetails("");
    setErr(undefined);
    setDone(false);
  }

  async function submit() {
    if (!reason) {
      setErr(t("social.report.reason_required"));
      return;
    }
    setErr(undefined);
    setBusy(true);
    try {
      await onSubmit(reason, details.trim());
      setDone(true);
    } catch {
      setErr(t("common.error_title"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={title}
      closeLabel={t("common.close")}
    >
      {done ? (
        <div className="vc-stack">
          <Banner tone="success" icon="check">{t("social.report.received")}</Banner>
          <Button block onClick={() => { reset(); onClose(); }}>{t("common.close")}</Button>
        </div>
      ) : (
        <div className="vc-stack">
          <fieldset className="soc-report__reasons">
            <legend className="vc-sr-only">{t("social.report.reason_label")}</legend>
            {reasons.map((r) => (
              <label key={r.value} className="soc-report__reason">
                <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <div className="vc-field">
            <label htmlFor="report-details" className="vc-field__label">{t("social.report.details_label")}</label>
            <textarea id="report-details" className="soc-reviewform__textarea" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
          <div className="vc-row">
            <Button variant="secondary" onClick={() => { reset(); onClose(); }}>{t("common.close")}</Button>
            <Button loading={busy} onClick={submit}>{t("social.report.submit")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
