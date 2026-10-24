import type { OrderDetail } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { ORDER_STATUS_META, formatOrderTime, orderStatusLabel, reachedStatuses, timelineStatuses } from "./orderHelpers";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Shared by the customer tracking screen and the vendor order-detail screen — both show the same
 * status history, just with different actions attached below it. */
export function OrderTimeline({ order }: { order: OrderDetail }) {
  const { t, lang } = useI18n();
  const steps = timelineStatuses(order.fulfilment, order.status);
  const reached = reachedStatuses(order);
  const eventFor = (status: string) => order.events.find((e) => e.status === status);

  return (
    <ol className="o-timeline" aria-label={t("order.timeline_title")}>
      {steps.map((status, i) => {
        const done = reached.has(status);
        const isLast = i === steps.length - 1;
        const isCurrent = status === order.status;
        const isBad = status === "rejected" || status === "cancelled";
        const event = eventFor(status);
        return (
          <li key={status} className={cx("o-timeline__step", done && "is-done", isCurrent && "is-current", isBad && done && "is-rejected")}>
            <span className="o-timeline__rail">
              <span className="o-timeline__dot" aria-hidden="true" />
              {!isLast ? <span className="o-timeline__line" aria-hidden="true" /> : null}
            </span>
            <span className="o-timeline__text">
              <span className="o-timeline__label">
                {orderStatusLabel(t, status)}
                {done ? " ✓" : ""}
              </span>
              {event ? <span className="o-timeline__time">{formatOrderTime(event.created_at, lang)}</span> : null}
              {status === "rejected" && order.rejection_reason ? <span className="o-timeline__note">{order.rejection_reason}</span> : null}
              {event?.note && status !== "rejected" ? <span className="o-timeline__note">{event.note}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export { ORDER_STATUS_META };
