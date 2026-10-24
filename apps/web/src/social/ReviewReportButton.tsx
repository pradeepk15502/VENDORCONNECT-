import { useSession, REPORT_REVIEW_REASONS } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { Button } from "@vc/ui";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ReportDialog } from "./ReportDialog";

/** "Report" action for a single review (master prompt §27) — a plain `footer` for `<ReviewCard>`,
 * so any screen listing reviews (a shop's Reviews tab, a product page) gets the same real
 * `POST /reviews/{id}/report` flow without re-implementing the dialog. */
export function ReviewReportButton({ reviewId }: { reviewId: string }) {
  const { t } = useI18n();
  const { api, status } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  function start() {
    if (status !== "authenticated") {
      nav("/login", { state: { from: loc.pathname } });
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <Button variant="ghost" icon="alert" onClick={start}>{t("social.report.review_action")}</Button>
      <ReportDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("social.report.review_title")}
        reasons={REPORT_REVIEW_REASONS.map((r) => ({ value: r, label: t(`social.report.reason.${r}` as MessageKey) }))}
        onSubmit={(reason, details) => api.reviews.report(reviewId, { reason, details })}
      />
    </>
  );
}
