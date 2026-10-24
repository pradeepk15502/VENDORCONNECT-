/** Mirrors services/api/vc/vendors/handles.py HANDLE_RE. Search uses this to short-circuit: if
 * what the customer typed looks like a Vendor ID, look the shop up directly (GET /vendors/{handle})
 * instead of running it through product search (ARCHITECTURE D10 step 2). */
const HANDLE_RE = /^[A-Z]{2,8}\d{3,5}$/;

export function looksLikeVendorHandle(raw: string): boolean {
  return HANDLE_RE.test(raw.trim().replace(/^@/, "").toUpperCase());
}
