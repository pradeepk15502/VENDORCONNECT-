/* Which half of the single VendorConnect app is active on this device (see ARCHITECTURE D4/D20).
 * Chosen once on RoleSelectScreen, then remembered like the language choice; switchable later from
 * Profile (customer -> vendor) or Shop settings (vendor -> customer) without logging out, because a
 * role is a UI mode, not a separate account — one login can be both a customer and a vendor. */
// Named ActiveRole (not Role) to avoid colliding with @vc/api-client's `Role`, which is the
// backend's admin/moderator/support permission grant — an unrelated concept.
export type ActiveRole = "customer" | "vendor";
const KEY = "vc.role";

export function getActiveRole(): ActiveRole | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "customer" || v === "vendor" ? v : null;
  } catch {
    return null;
  }
}

export function setActiveRole(r: ActiveRole) {
  try {
    localStorage.setItem(KEY, r);
  } catch {
    /* private mode: the caller's own state still updates for this session */
  }
}
