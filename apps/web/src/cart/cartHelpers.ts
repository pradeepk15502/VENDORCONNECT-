import type { CartItem } from "@vc/api-client";

export interface CartGroup {
  vendorHandle: string;
  items: CartItem[];
  subtotal: number;
  /** Whether this vendor group can be checked out right now — closed shops and shops that went
   * inactive since the item was added block checkout (the server re-checks this again anyway; this
   * only decides whether to show the button as disabled). */
  canCheckout: boolean;
}

/** Cart items from different vendors sit in one cart but are always reviewed/checked out one vendor
 * at a time (ARCHITECTURE D29) — this is the one place that grouping happens, so the Cart screen and
 * any summary badge use the same numbers. */
export function groupCartByVendor(items: CartItem[]): CartGroup[] {
  const byHandle = new Map<string, CartItem[]>();
  for (const item of items) {
    const list = byHandle.get(item.vendor.handle);
    if (list) list.push(item);
    else byHandle.set(item.vendor.handle, [item]);
  }
  return Array.from(byHandle.entries()).map(([vendorHandle, groupItems]) => {
    const subtotal = groupItems.reduce((sum, i) => sum + Number(i.line_total), 0);
    const vendor = groupItems[0].vendor;
    const canCheckout = vendor.status === "active" && vendor.is_open && groupItems.every((i) => i.listing_status === "active" && i.availability !== "out_of_stock");
    return { vendorHandle, items: groupItems, subtotal, canCheckout };
  });
}

export function cartTotalItemCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + Number(i.quantity), 0);
}
