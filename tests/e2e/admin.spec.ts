import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Phase 9/10 admin auth + AI Scans, plus Phase 11's admin back-office (ARCHITECTURE D32): Users,
 * Vendors + verification, Products/Categories, Orders, Audit logs. Runs against the "admin"
 * Playwright project (baseURL http://localhost:4175); flows that need a real customer/vendor
 * account go through the "web" app on http://localhost:4173 in a separate browser context, exactly
 * like vendor.spec.ts's cross-app customer check. Demo data comes from run-stack.sh's seed_demo:
 * Sharma Vegetable Store (@SHARMA001, verified, open, pickup-enabled, real "Tomato" listing). */

const ADMIN_PHONE = process.env.E2E_ADMIN_PHONE ?? "9000000001";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-123";

async function adminLogin(page: Page) {
  await page.goto("/");
  await page.getByLabel("Mobile number").fill(ADMIN_PHONE);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await enterDevOtp(page);
  await expect(page.getByTestId("admin-who")).toContainText("admin");
}

/** Logs a phone number into the customer half of the web app (a fresh signup the first time, an
 * ordinary login on any later attempt with the same phone — same form either way). Caller asserts
 * the outcome (a real account never fails this step; a suspended one shows an error here instead
 * of the Home screen). */
async function customerLogin(page: Page, phone: string, name: string) {
  await page.goto("http://localhost:4173/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "customer");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Choose area manually" }).click();
  await page.getByRole("button", { name: /Gurugram/ }).click();
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel(/Your name/).fill(name);
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);
}

/** Onboards a brand-new vendor (always unverified — verification_status defaults to "unverified",
 * ARCHITECTURE D32) through the real wizard, in its own browser context so it survives independent
 * of the admin session. */
async function createVendor(browser: Browser, shopName: string): Promise<{ page: Page; handle: string }> {
  const ctx = await browser.newContext({ geolocation: { latitude: 28.4601, longitude: 77.0268 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "vendor");
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel(/Your name/).fill("E2E Vendor Owner");
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);

  await expect(page.getByRole("heading", { name: "Set up your shop" })).toBeVisible();
  await page.getByLabel("Shop name").fill(shopName);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Choose up to 5.").last()).toBeVisible();
  await page.getByRole("button", { name: "Vegetables" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Create my shop" }).click();
  await expect(page.getByText("Please capture your shop location.")).toBeVisible();
  await page.getByRole("button", { name: /use GPS/ }).click();
  await expect(page.getByTestId("coords")).toContainText("28.4601");
  await page.getByLabel("Shop address").fill("E2E fixture address");
  await page.getByLabel("City").fill("Gurugram");
  await page.getByLabel("PIN code").fill("122001");
  await page.getByRole("button", { name: "Create my shop" }).click();

  await expect(page.getByRole("heading", { name: "Your shop is live!" })).toBeVisible();
  const handle = (await page.getByTestId("vendor-id").textContent())!.trim();
  return { page, handle };
}

test("admin: password + OTP → admin session, real dashboard metrics, every sidebar section is genuinely wired", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Mobile number").fill(ADMIN_PHONE);
  await page.getByLabel("Password").fill("wrong-password-000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Invalid phone or password.")).toBeVisible();

  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await enterDevOtp(page);
  await expect(page.getByTestId("admin-who")).toContainText("admin");

  // Dashboard (Phase 11 §4/§5): real, live-computed numbers — not a placeholder. The admin's own
  // account guarantees users.total is at least 1, so this is a genuine assertion, not a smoke test.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Total accounts (all time)")).toBeVisible();
  const usersStat = page.locator(".a-stat", { hasText: "Total accounts (all time)" }).locator(".a-stat__value");
  await expect(usersStat).not.toHaveText("0");
  await page.getByRole("button", { name: "Last 30 days" }).click();
  await expect(page.getByText("Total accounts (all time)")).toBeVisible(); // range switch re-fetches without erroring

  // Every domain the master prompt asked for is a real section now, not the old "Coming in
  // Phase 11" placeholder every still-unbuilt section used to show.
  for (const label of ["Users", "Vendors", "Vendor verification", "Products", "Categories", "Orders", "Audit logs"]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByText("Coming in Phase 11")).toHaveCount(0);
  }

  // Phase 10's AI Scans stays real too (regression, not rebuilt).
  await page.getByRole("link", { name: "AI Scans" }).click();
  await expect(page.getByRole("heading", { name: "AI Scans" })).toBeVisible();
  await expect(page.getByText("Coming in Phase 11")).toHaveCount(0);

  // Settings (Phase 11 §35): a documented gap, not a fabricated form — the repo genuinely has no
  // platform-wide settings model to expose here.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("No platform-wide settings exist yet")).toBeVisible();
});

test("admin users: search finds a real account, suspend blocks login, restore unblocks it", async ({ page, browser }) => {
  await adminLogin(page);
  const phone = randomPhone();

  const signupCtx = await browser.newContext();
  const spage = await signupCtx.newPage();
  await customerLogin(spage, phone, "E2E Suspendee");
  await expect(spage.getByRole("heading", { name: "Hello, E2E" })).toBeVisible();
  await signupCtx.close();

  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  // let the initial unfiltered fetch settle first — filtering immediately on mount can otherwise
  // race it, and a slower unfiltered response resolving second would overwrite the filtered result
  await expect(page.getByText("Loading…")).toHaveCount(0);
  // search by phone (guaranteed unique per run) rather than the shared display name, which repeat
  // runs against this persistent dev DB would otherwise accumulate into several matching rows
  await page.getByLabel("Search").fill(phone);
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator("tr", { hasText: phone }).click();
  await expect(page.getByRole("heading", { name: "User detail" })).toBeVisible();

  await page.getByLabel("Suspension reason").fill("E2E test suspension");
  await page.getByRole("button", { name: "Suspend account" }).click();
  await expect(page.getByText("Suspended: E2E test suspension")).toBeVisible();

  // a suspended account is rejected mid-login, server-side (not just hidden client-side)
  const blockedCtx = await browser.newContext();
  const bpage = await blockedCtx.newPage();
  await customerLogin(bpage, phone, "E2E Suspendee");
  await expect(bpage.getByText("This account is suspended. Contact support.")).toBeVisible();
  await blockedCtx.close();

  await page.getByRole("button", { name: "Restore account" }).click();
  // scoped to the still-open modal: the filtered table row behind it repeats the same "Active" badge
  await expect(page.getByRole("dialog").getByText("Active", { exact: true })).toBeVisible();

  const restoredCtx = await browser.newContext();
  const rpage = await restoredCtx.newPage();
  await customerLogin(rpage, phone, "E2E Suspendee");
  await expect(rpage.getByRole("heading", { name: "Hello, E2E" })).toBeVisible();
  await restoredCtx.close();
});

test("admin vendor verification: a freshly onboarded shop starts unverified, admin verifies it, the public profile reflects it immediately", async ({
  page,
  browser,
}) => {
  await adminLogin(page);
  const shopName = `E2E Verify Store ${Date.now()}`;
  const vendor = await createVendor(browser, shopName);

  await page.getByRole("link", { name: "Vendor verification" }).click();
  await expect(page.getByRole("heading", { name: "Vendor verification" })).toBeVisible();
  // let the initial unfiltered fetch settle before applying filters (see the Products race above)
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.getByLabel("Filter by verification status").selectOption("unverified");
  await page.getByLabel("Search").fill(shopName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator("tr", { hasText: shopName }).click();
  await expect(page.getByRole("heading", { name: "Vendor detail" })).toBeVisible();

  await page.getByLabel("Verification notes (optional)").fill("Docs checked by E2E");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  // scoped to the modal: "verified" is also a literal <option> value in the status filter <select>
  await expect(page.getByRole("dialog").getByText("verified", { exact: true })).toBeVisible();

  await vendor.page.goto(`http://localhost:4173/v/${vendor.handle.toLowerCase()}`);
  await expect(vendor.page.getByText("Verified")).toBeVisible();
  await vendor.page.context().close();
});

test("admin vendor suspend/restore: a suspended shop is unreachable publicly, restoring brings it right back", async ({ page, browser }) => {
  await adminLogin(page);
  const shopName = `E2E Suspend Store ${Date.now()}`;
  const vendor = await createVendor(browser, shopName);

  await page.getByRole("link", { name: "Vendors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vendors", exact: true })).toBeVisible();
  // let the initial unfiltered fetch settle before applying filters (see the Products race above)
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.getByLabel("Search").fill(shopName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator("tr", { hasText: shopName }).click();
  await expect(page.getByRole("heading", { name: "Vendor detail" })).toBeVisible();

  await page.getByLabel("Suspension reason").fill("E2E fraud check");
  await page.getByRole("button", { name: "Suspend shop" }).click();
  // scoped to the modal: "suspended"/"active" are also literal <option> values in the status filter
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("suspended", { exact: true })).toBeVisible();

  await vendor.page.goto(`http://localhost:4173/v/${vendor.handle.toLowerCase()}`);
  await expect(vendor.page.getByText("No shops to show yet.")).toBeVisible();

  await page.getByRole("button", { name: "Restore shop" }).click();
  await expect(dialog.getByText("active", { exact: true })).toBeVisible();

  await vendor.page.reload();
  await expect(vendor.page.getByTestId("vendor-name")).toHaveText(shopName);
  await vendor.page.context().close();
});

test("admin catalog: Products and Categories show real, live listing data (not seeded/fabricated counts)", async ({ page }) => {
  await adminLogin(page);

  await page.getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  // this section re-fetches on every keystroke with no request-sequencing guard, so an unfiltered
  // fetch issued earlier (e.g. on mount) can occasionally resolve after a filtered one and silently
  // overwrite it — first let the initial fetch fully settle, then wait for the specific filtered
  // response itself rather than any DOM/timing proxy
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/admin/products?vendor=SHARMA001") && r.ok()),
    page.getByLabel("Vendor handle").fill("SHARMA001"),
  ]);
  await page.getByRole("button", { name: "Search" }).click();
  // toHaveCount (unlike toBeVisible) polls rather than hard-failing on a transient extra match, so
  // this rides out a stale unfiltered row that hasn't been replaced by the client yet
  await expect(page.locator("tr", { hasText: "Tomato" })).toHaveCount(1);
  await expect(page.locator("tr", { hasText: "Suresh" })).toHaveCount(0);

  await page.getByRole("link", { name: "Categories" }).click();
  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  const veg = page.locator("tr", { hasText: "vegetables" });
  await expect(veg).toBeVisible();
  const cells = await veg.locator("td").allTextContents();
  expect(Number(cells[3])).toBeGreaterThan(0); // real listings in this category (Sharma's Tomato, at least)
  expect(Number(cells[4])).toBeGreaterThan(0); // real vendors selling in this category
});

test("admin orders: a real order shows up in cross-vendor visibility without ever exposing the customer's phone", async ({ page, browser }) => {
  await adminLogin(page);

  const orderCtx = await browser.newContext();
  const opage = await orderCtx.newPage();
  // unique per run — this persistent dev DB accumulates orders across repeated E2E runs, and the
  // Orders search only matches by name/number/vendor, not phone
  const customerName = `E2E Orderer ${Date.now()}`;
  await customerLogin(opage, randomPhone(), customerName);
  // the home greeting shows only the first word of the name (see HomeScreen.tsx)
  await expect(opage.getByRole("heading", { name: "Hello, E2E" })).toBeVisible();
  await opage.goto("http://localhost:4173/v/SHARMA001");
  await expect(opage.getByTestId("vendor-name")).toBeVisible();
  const row = opage.locator(".c-result", { hasText: "Tomato" });
  await row.getByRole("button", { name: "Add to cart" }).click();
  await expect(row.getByText("Added ✓")).toBeVisible();
  await opage.goto("http://localhost:4173/cart");
  await opage.getByRole("button", { name: "Checkout" }).click();
  await expect(opage).toHaveURL(/\/checkout\//);
  await opage.getByRole("button", { name: "Place order" }).click();
  await expect(opage).toHaveURL(/\/orders\/[^/]+$/);
  await expect(opage.getByText("Placed ✓")).toBeVisible();
  await orderCtx.close();

  await page.getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  // let the initial unfiltered fetch settle before applying filters (see the Products race above)
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.getByLabel("Search").fill(customerName);
  await page.getByRole("button", { name: "Search" }).click();
  const orderRow = page.locator("tr", { hasText: customerName });
  await expect(orderRow).toBeVisible();
  await expect(orderRow).toContainText("SHARMA001");
  await orderRow.click();
  await expect(page.getByRole("heading", { name: "Order detail" })).toBeVisible();
  await expect(page.getByText("Tomato")).toBeVisible();
  // support visibility mirrors what the vendor/customer sides already see — never a raw phone number
  await expect(page.getByText(/\+91\d{10}/)).toHaveCount(0);
});

test("admin audit logs: real admin actions are visible and filterable, with no edit/delete affordance anywhere", async ({ page, browser }) => {
  await adminLogin(page);
  const shopName = `E2E Audit Store ${Date.now()}`;
  const vendor = await createVendor(browser, shopName);

  await page.getByRole("link", { name: "Vendor verification" }).click();
  // let the initial unfiltered fetch settle before applying filters (see the Products race above)
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.getByLabel("Filter by verification status").selectOption("unverified");
  await page.getByLabel("Search").fill(shopName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator("tr", { hasText: shopName }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  // scoped to the modal: "verified" is also a literal <option> value in the status filter <select>
  await expect(page.getByRole("dialog").getByText("verified", { exact: true })).toBeVisible();
  await vendor.page.context().close();
  // a native <dialog> makes the rest of the page inert while open — close it before navigating away
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "Audit logs" }).click();
  await expect(page.getByRole("heading", { name: "Audit logs" })).toBeVisible();
  // let the initial unfiltered fetch settle before applying filters (see the Products race above)
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.getByLabel("Action").fill("vendor.verified");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("tr", { hasText: "vendor.verified" }).first()).toBeVisible();

  // append-only: nothing on this screen lets even an admin edit or delete a row
  await expect(page.getByRole("button", { name: /edit/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
});
