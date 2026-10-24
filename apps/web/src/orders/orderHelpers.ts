import type { OrderAction, OrderDetail, OrderStatus } from "@vc/api-client";
import type { MessageKey } from "@vc/i18n";
import type { IconName } from "@vc/ui";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Visual language for each status — reuses the shared badge tones (`vc-badge--{tone}`) rather than
 * the narrower `StatusKind` union (built for shop-open/stock badges, not order statuses). */
export const ORDER_STATUS_META: Record<OrderStatus, { tone: "open" | "closed" | "low" | "stale" | "info"; icon: IconName; key: MessageKey }> = {
  placed: { tone: "info", icon: "clock", key: "order.status.placed" },
  accepted: { tone: "info", icon: "check", key: "order.status.accepted" },
  rejected: { tone: "closed", icon: "x", key: "order.status.rejected" },
  preparing: { tone: "low", icon: "box", key: "order.status.preparing" },
  ready: { tone: "open", icon: "bag", key: "order.status.ready" },
  picked_up: { tone: "open", icon: "check", key: "order.status.picked_up" },
  out_for_delivery: { tone: "info", icon: "truck", key: "order.status.out_for_delivery" },
  delivered: { tone: "open", icon: "check", key: "order.status.delivered" },
  completed: { tone: "open", icon: "check", key: "order.status.completed" },
  cancelled: { tone: "closed", icon: "x", key: "order.status.cancelled" },
};

export function orderStatusLabel(t: T, status: OrderStatus): string {
  return t(ORDER_STATUS_META[status].key);
}

/** The tracking screen's timeline — always the same ordered steps for a given fulfilment, with
 * whichever ones the order's own event history reached lit up (mirrors the master prompt's own
 * "Placed✓ Accepted✓ Preparing✓ Ready✓ Picked Up/Out for Delivery✓ Completed" spec). A rejected or
 * cancelled order gets its own short two-step timeline instead. */
export function timelineStatuses(fulfilment: "pickup" | "delivery", currentStatus: OrderStatus): OrderStatus[] {
  if (currentStatus === "rejected") return ["placed", "rejected"];
  if (currentStatus === "cancelled") return ["placed", "cancelled"];
  const handoff: OrderStatus = fulfilment === "pickup" ? "picked_up" : "out_for_delivery";
  const steps: OrderStatus[] = ["placed", "accepted", "preparing", "ready", handoff];
  if (fulfilment === "delivery") steps.push("delivered");
  steps.push("completed");
  return steps;
}

/** Which of the timeline's steps has this order actually reached, by event history — not just
 * "is this the current status," since a step earlier than the current one is still "done." */
export function reachedStatuses(order: Pick<OrderDetail, "events">): Set<OrderStatus> {
  return new Set(order.events.map((e) => e.status));
}

/** What the *vendor* can do next from this order's current status/fulfilment — mirrors
 * `vc.orders.transitions.RULES` on the backend (the frontend only decides which buttons to show;
 * the server is still the sole authority and re-checks everything itself). */
export function vendorActions(order: Pick<OrderDetail, "status" | "fulfilment">): OrderAction[] {
  switch (order.status) {
    case "placed":
      return ["accept", "reject"];
    case "accepted":
      return ["preparing"];
    case "preparing":
      return ["ready"];
    case "ready":
      return [order.fulfilment === "pickup" ? "picked_up" : "out_for_delivery"];
    case "out_for_delivery":
      return order.fulfilment === "delivery" ? ["delivered"] : [];
    case "picked_up":
      return order.fulfilment === "pickup" ? ["completed"] : [];
    case "delivered":
      return order.fulfilment === "delivery" ? ["completed"] : [];
    default:
      return [];
  }
}

const ACTION_LABEL_KEY: Record<OrderAction, MessageKey> = {
  accept: "v.orders.accept",
  reject: "v.orders.reject",
  preparing: "v.orders.mark_preparing",
  ready: "v.orders.mark_ready",
  picked_up: "v.orders.mark_picked_up",
  out_for_delivery: "v.orders.mark_out_for_delivery",
  delivered: "v.orders.mark_delivered",
  completed: "v.orders.mark_completed",
  cancel: "order.cancel",
};

export function actionLabel(t: T, action: OrderAction): string {
  return t(ACTION_LABEL_KEY[action]);
}

/** The customer may cancel only before the vendor has acted (mirrors `transitions.RULES["cancel"]`
 * on the backend — placed-only). */
export function customerCanCancel(order: Pick<OrderDetail, "status">): boolean {
  return order.status === "placed";
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === "rejected" || status === "cancelled" || status === "completed";
}

export function formatOrderTime(iso: string, lang: "en" | "hi"): string {
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
