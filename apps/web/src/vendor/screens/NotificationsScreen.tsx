import { useSession, type NotificationItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, EmptyState, ErrorState, Screen, Skeleton } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatOrderTime } from "../../orders/orderHelpers";

export function NotificationsScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null);
    api.notifications.list({ page_size: 50 }).then((r) => setItems(r.results)).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  async function open(n: NotificationItem) {
    if (!n.read_at) await api.notifications.markRead(n.id).catch(() => undefined);
    const orderId = n.data?.order_id;
    if (typeof orderId === "string") nav(`/vendor/orders/${orderId}`);
    else load();
  }

  async function markAllRead() {
    await api.notifications.markAllRead().catch(() => undefined);
    load();
  }

  const hasUnread = !!items?.some((n) => !n.read_at);

  return (
    <Screen>
      <AppBar title={t("notif.title")} onBack={() => nav("/vendor")} backLabel={t("common.back")} right={
        hasUnread ? <Button variant="ghost" onClick={markAllRead}>{t("notif.mark_all_read")}</Button> : null
      } />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title={t("notif.empty")} />
      ) : (
        <ul className="vc-list">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className="c-listbtn" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4, fontWeight: n.read_at ? 500 : 700 }} onClick={() => open(n)}>
                <span>{n.title}</span>
                {n.body ? <span className="vc-muted" style={{ fontWeight: 400 }}>{n.body}</span> : null}
                <span className="vc-muted" style={{ fontWeight: 400, fontSize: "var(--vc-text-sm)" }}>{formatOrderTime(n.created_at, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
