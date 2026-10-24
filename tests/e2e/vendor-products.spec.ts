import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 4 (vendor product catalog: create/edit/delete, one-tap stock, price updates)
 * and Phase 5 (the dashboard's real GET /vendors/me/summary-backed overview tiles) end to end —
 * real signup, real shop, real API calls, no mocked data. */

test.use({ geolocation: { latitude: 28.4601, longitude: 77.0268 }, permissions: ["geolocation"] });

async function toVendorDashboard(page: import("@playwright/test").Page, shopName: string) {
  await page.goto("/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "vendor");
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel(/Your name/).fill("Ramesh");
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);

  await expect(page.getByRole("heading", { name: "Set up your shop" })).toBeVisible();
  await page.getByLabel("Shop name").fill(shopName);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Vegetables" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /use GPS/ }).click();
  await page.getByLabel("Shop address").fill("Shop 9, Sector 14 Market");
  await page.getByLabel("City").fill("Gurugram");
  await page.getByRole("button", { name: "Create my shop" }).click();
  await expect(page.getByRole("heading", { name: "Your shop is live!" })).toBeVisible();
  await page.getByRole("button", { name: "Go to my shop" }).click();
  await expect(page.getByTestId("shop-state")).toBeVisible();
}

test("vendor products: add, list, one-tap stock toggle, price edit, delete", async ({ page }) => {
  await toVendorDashboard(page, "Product Test Store");

  // dashboard stat tiles start real (not fake) — zero products before any are added
  await expect(page.locator(".v-stat", { hasText: "Products" }).locator("b")).toHaveText("0");

  // Add Product quick action -> create form
  await page.getByRole("button", { name: "Add Product" }).click();
  await expect(page).toHaveURL(/\/vendor\/products\/new/);
  await expect(page.getByRole("heading", { name: "Add product" })).toBeVisible();

  await page.getByLabel("Product name").fill("Fresh Spinach Bundle");
  await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Vegetables" }).click();
  await page.getByLabel("Price").fill("20");
  await page.getByRole("group", { name: "Sold by" }).getByRole("button", { name: "kg" }).click();
  await page.getByRole("button", { name: "Add product" }).last().click();

  // create redirects straight into edit — proves the listing round-trips through the real API
  await expect(page).toHaveURL(/\/vendor\/products\/.+\/edit/);
  await expect(page.getByRole("heading", { name: "Edit product" })).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveValue("Fresh Spinach Bundle");

  // Products tab shows the new listing with real price/unit/availability. The edit screen itself
  // has no bottom nav (a focused single-purpose screen), so reach the list the way a vendor would:
  // back to wherever "Add Product" was launched from (which always has the nav), then the tab.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: "Products" }).click();
  await expect(page).toHaveURL(/\/vendor\/products$/);
  const row = page.locator(".v-prow", { hasText: "Fresh Spinach Bundle" });
  await expect(row).toBeVisible();
  await expect(row.getByText("₹20")).toBeVisible();
  await expect(row.getByText("In stock", { exact: true })).toBeVisible();

  // dashboard now reflects the real count
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator(".v-stat", { hasText: "Products" }).locator("b")).toHaveText("1");
  await page.getByRole("link", { name: "Products" }).click();

  // one-tap stock cycle: in_stock -> low_stock, a real POST /inventory each tap
  await row.getByRole("button", { name: "Change stock status" }).click();
  await expect(row.getByText("Low stock", { exact: true })).toBeVisible();

  // dashboard's "Low stock" overview tile reflects it too — same summary endpoint, not just the row
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator(".v-stat", { hasText: "Low stock" }).locator("b")).toHaveText("1");
  await expect(page.locator(".v-stat", { hasText: "Out of stock" }).locator("b")).toHaveText("0");
  await page.getByRole("link", { name: "Products" }).click();

  // edit: change price via the dedicated /prices write path
  await row.click();
  await expect(page.getByRole("heading", { name: "Edit product" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Stock status" }).getByRole("button", { name: "Low stock", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Price").fill("25");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/vendor\/products$/);
  await expect(row.getByText("₹25")).toBeVisible();

  // delete, with the confirmation modal actually gating it
  await row.click();
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete product" }).click();
  await expect(page).toHaveURL(/\/vendor\/products$/);
  await expect(page.getByText("Fresh Spinach Bundle")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No products yet" })).toBeVisible();
});

test("vendor products: two independently-created free-text listings coexist (no false duplicate conflict)", async ({ page }) => {
  // The create form never links a listing to the shared Product catalog (no picker UI — see the
  // Phase 4 note atop VendorProductFormScreen.tsx), so the `uniq_active_listing` constraint, which
  // only applies when `product` is set, can never fire through this UI. This test locks in the
  // actually-reachable behavior: two of a vendor's own free-text listings never conflict with
  // each other, however similar their names — duplicate-conflict handling itself is covered by
  // the backend's own test_vendor_products.py::test_duplicate_active_listing_conflicts.
  await toVendorDashboard(page, "Duplicate Test Store");
  await page.getByRole("button", { name: "Add Product" }).click();
  await page.getByLabel("Product name").fill("Item One");
  await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Vegetables" }).click();
  await page.getByLabel("Price").fill("10");
  await page.getByRole("button", { name: "Add product" }).last().click();
  await expect(page).toHaveURL(/\/vendor\/products\/.+\/edit/);

  // edit has no bottom nav — back to wherever "Add Product" was launched from, then the tab
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: "Products" }).click();
  await page.getByRole("button", { name: "Add Product" }).click();
  await page.getByLabel("Product name").fill("Item Two");
  await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Vegetables" }).click();
  await page.getByLabel("Price").fill("15");
  await page.getByRole("button", { name: "Add product" }).last().click();
  await expect(page).toHaveURL(/\/vendor\/products\/.+\/edit/);

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: "Products" }).click();
  await expect(page.locator(".v-prow")).toHaveCount(2);
});

test("vendor dashboard: overview has no fake orders/sales, unbuilt quick actions are honest", async ({ page }) => {
  await toVendorDashboard(page, "Honesty Check Store");

  // only real, computed tiles appear — no hardcoded "Orders"/"Sales" figures (Phase 8's, not yet built)
  await expect(page.getByRole("heading", { name: "Shop overview" })).toBeVisible();
  await expect(page.locator(".v-stat")).toHaveCount(3);
  await expect(page.locator(".v-stat", { hasText: "Orders" })).toHaveCount(0);
  await expect(page.locator(".v-stat", { hasText: "Sales" })).toHaveCount(0);

  // "Create Post" is now a real Phase 9 feature (posts/reviews/following) — it must land on the
  // real composer, not a placeholder.
  await page.getByRole("button", { name: "Create Post" }).click();
  await expect(page).toHaveURL(/\/vendor\/posts\/new$/);
  await expect(page.getByRole("heading", { name: "Create post" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  // "AI Scan Product" is now a real Phase 10 feature — it must land on the real scan screen, not a
  // placeholder. The full scan -> confirm -> product-creation flow is covered end to end in
  // ai-scan.spec.ts; this just proves the dashboard tile wires to the real screen.
  await page.getByRole("button", { name: "AI Scan Product" }).click();
  await expect(page).toHaveURL(/\/vendor\/products\/scan$/);
  await expect(page.getByRole("heading", { name: "Scan a product" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take Photo" })).toBeVisible();
});
