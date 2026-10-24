import { describe, expect, it } from "vitest";
import type { OrderDetail, OrderStatus } from "@vc/api-client";
import { customerCanCancel, isTerminalStatus, reachedStatuses, timelineStatuses, vendorActions } from "./orderHelpers";

function eventsUpTo(statuses: OrderStatus[]): OrderDetail["events"] {
  return statuses.map((status) => ({ status, note: "", actor_side: "vendor" as const, created_at: "2026-01-01T00:00:00Z" }));
}

describe("timelineStatuses", () => {
  it("builds the pickup timeline ending in picked_up then completed", () => {
    expect(timelineStatuses("pickup", "preparing")).toEqual(["placed", "accepted", "preparing", "ready", "picked_up", "completed"]);
  });
  it("builds the delivery timeline with out_for_delivery and delivered before completed", () => {
    expect(timelineStatuses("delivery", "placed")).toEqual(["placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "completed"]);
  });
  it("collapses to a two-step timeline once rejected", () => {
    expect(timelineStatuses("pickup", "rejected")).toEqual(["placed", "rejected"]);
  });
  it("collapses to a two-step timeline once cancelled", () => {
    expect(timelineStatuses("delivery", "cancelled")).toEqual(["placed", "cancelled"]);
  });
});

describe("reachedStatuses", () => {
  it("returns the set of statuses the order's own event history has passed through", () => {
    const reached = reachedStatuses({ events: eventsUpTo(["placed", "accepted", "preparing"]) });
    expect(reached.has("preparing")).toBe(true);
    expect(reached.has("ready")).toBe(false);
  });
});

describe("vendorActions", () => {
  it("offers accept/reject from placed", () => {
    expect(vendorActions({ status: "placed", fulfilment: "pickup" })).toEqual(["accept", "reject"]);
  });
  it("offers picked_up from ready for a pickup order", () => {
    expect(vendorActions({ status: "ready", fulfilment: "pickup" })).toEqual(["picked_up"]);
  });
  it("offers out_for_delivery from ready for a delivery order", () => {
    expect(vendorActions({ status: "ready", fulfilment: "delivery" })).toEqual(["out_for_delivery"]);
  });
  it("offers nothing once a pickup order is picked up (it's already completable)", () => {
    expect(vendorActions({ status: "picked_up", fulfilment: "pickup" })).toEqual(["completed"]);
  });
  it("offers nothing from a terminal status", () => {
    expect(vendorActions({ status: "completed", fulfilment: "pickup" })).toEqual([]);
    expect(vendorActions({ status: "rejected", fulfilment: "pickup" })).toEqual([]);
    expect(vendorActions({ status: "cancelled", fulfilment: "delivery" })).toEqual([]);
  });
  it("never offers picked_up for a delivery order or out_for_delivery for a pickup order", () => {
    expect(vendorActions({ status: "out_for_delivery", fulfilment: "pickup" })).toEqual([]);
    expect(vendorActions({ status: "delivered", fulfilment: "pickup" })).toEqual([]);
  });
});

describe("customerCanCancel", () => {
  it("allows cancellation only while still placed", () => {
    expect(customerCanCancel({ status: "placed" })).toBe(true);
    expect(customerCanCancel({ status: "accepted" })).toBe(false);
    expect(customerCanCancel({ status: "completed" })).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("flags rejected, cancelled and completed as terminal", () => {
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("completed")).toBe(true);
  });
  it("does not flag in-progress statuses as terminal", () => {
    expect(isTerminalStatus("placed")).toBe(false);
    expect(isTerminalStatus("preparing")).toBe(false);
    expect(isTerminalStatus("out_for_delivery")).toBe(false);
  });
});
