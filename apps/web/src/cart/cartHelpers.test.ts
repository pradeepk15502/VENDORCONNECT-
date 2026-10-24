import { describe, expect, it } from "vitest";
import type { CartItem } from "@vc/api-client";
import { cartTotalItemCount, groupCartByVendor } from "./cartHelpers";

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "ci1",
    listing_id: "l1",
    listing_status: "active",
    name: "Tomato",
    unit: "kg",
    unit_quantity: "1",
    price: "40.00",
    mrp: null,
    availability: "in_stock",
    vendor: { handle: "SHARMA001", vendor_id: "SHARMA001", shop_name: "Sharma", status: "active", is_open: true, delivery: { delivery_enabled: false, pickup_enabled: true, radius_km: "5", min_order_amount: "0", delivery_fee: "0", free_delivery_above: null } },
    quantity: "2",
    note: "",
    line_total: "80.00",
    added_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupCartByVendor", () => {
  it("groups items by vendor handle and sums each group's line totals", () => {
    const items = [
      item({ id: "a", vendor: { ...item().vendor, handle: "V1" }, line_total: "80.00" }),
      item({ id: "b", vendor: { ...item().vendor, handle: "V1" }, line_total: "20.00" }),
      item({ id: "c", vendor: { ...item().vendor, handle: "V2" }, line_total: "50.00" }),
    ];
    const groups = groupCartByVendor(items);
    expect(groups).toHaveLength(2);
    const v1 = groups.find((g) => g.vendorHandle === "V1")!;
    expect(v1.items).toHaveLength(2);
    expect(v1.subtotal).toBe(100);
    const v2 = groups.find((g) => g.vendorHandle === "V2")!;
    expect(v2.subtotal).toBe(50);
  });

  it("marks a group not checkoutable when the shop is closed", () => {
    const groups = groupCartByVendor([item({ vendor: { ...item().vendor, is_open: false } })]);
    expect(groups[0].canCheckout).toBe(false);
  });

  it("marks a group not checkoutable when the shop is suspended", () => {
    const groups = groupCartByVendor([item({ vendor: { ...item().vendor, status: "suspended" } })]);
    expect(groups[0].canCheckout).toBe(false);
  });

  it("marks a group not checkoutable when any item is out of stock or its listing was removed", () => {
    expect(groupCartByVendor([item({ availability: "out_of_stock" })])[0].canCheckout).toBe(false);
    expect(groupCartByVendor([item({ listing_status: "deleted" })])[0].canCheckout).toBe(false);
  });

  it("marks a group checkoutable when the shop is open and every item is available", () => {
    expect(groupCartByVendor([item()])[0].canCheckout).toBe(true);
  });

  it("returns an empty array for an empty cart", () => {
    expect(groupCartByVendor([])).toEqual([]);
  });
});

describe("cartTotalItemCount", () => {
  it("sums quantities across all items regardless of vendor", () => {
    expect(cartTotalItemCount([item({ quantity: "2" }), item({ quantity: "1.5" })])).toBe(3.5);
  });
  it("is zero for an empty cart", () => {
    expect(cartTotalItemCount([])).toBe(0);
  });
});
