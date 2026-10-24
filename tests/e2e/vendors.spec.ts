import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 3 (GET /vendors — nearby vendor discovery) against the demo data seeded by
 * run-stack.sh (seed_demo): Sharma Vegetable Store (open, verified, vegetables, ~50 m from the
 * Gurugram pick) and Suresh Kirana Store (closed, verified, grocery, ~2 km away). */

async function toHome(page: import("@playwright/test").Page) {
  await page.goto("/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "customer");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Choose area manually" }).click();
  await page.getByRole("button", { name: /Gurugram/ }).click();
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel(/Your name/).fill("Asha");
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);
  await expect(page.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();
}

test("vendors: Home 'Shops near you' shows the nearest open shop and links to its profile", async ({ page }) => {
  await toHome(page);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Shops near you" }) });
  const sharma = section.locator(".c-vcard", { hasText: "Sharma Vegetable Store" });
  await expect(sharma).toBeVisible();
  await expect(sharma.getByText("Open", { exact: true })).toBeVisible();
  await sharma.click();
  await expect(page).toHaveURL(/\/v\/SHARMA001/i);
  await expect(page.getByTestId("vendor-name")).toHaveText("Sharma Vegetable Store");
});

test("vendors: Vendors tab browses nearby shops and a category filter narrows them", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Shops" }).click();
  await expect(page).toHaveURL(/\/vendors/);

  // Unfiltered: Sharma is findable and open (other nearby fixtures from repeated local runs may
  // also appear here — this dev database isn't reset between E2E runs, unlike CI's ephemeral one —
  // so this test only asserts what Phase 3 itself guarantees, not an exact, fragile count).
  const sharma = page.locator(".c-vcard", { hasText: "Sharma Vegetable Store" });
  await expect(sharma).toBeVisible();
  await expect(sharma.getByText("Open", { exact: true })).toBeVisible();

  // Other spec files in this same run (e.g. vendor.spec.ts) create their own nearby vendors — some
  // in "Vegetables" too — so this only proves the category filter is wired end to end (the filter's
  // own correctness is unit-tested in test_vendor_list.py), not that Sharma is the only match.
  await page.getByRole("button", { name: "Vegetables" }).click();
  await expect(page).toHaveURL(/category=vegetables/);
  await expect(sharma).toBeVisible();
});

test("vendors: Open now filter (Phase 6) narrows real results, not just the UI", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Shops" }).click();
  await expect(page).toHaveURL(/\/vendors/);

  const sharma = page.locator(".c-vcard", { hasText: "Sharma Vegetable Store" });
  const suresh = page.locator(".c-vcard", { hasText: "Suresh Kirana Store" });
  await expect(sharma).toBeVisible();
  await expect(suresh).toBeVisible(); // closed, but still shown by default (D9: rank lower, never hide)

  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
  await page.getByRole("button", { name: "Open now" }).click();
  await page.getByRole("button", { name: "Show results" }).click();

  // a real GET /vendors?open_now=true round trip, not a client-side re-filter of the same page
  await expect(page).toHaveURL(/open_now=1/);
  await expect(sharma).toBeVisible();
  await expect(suresh).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();

  // "Clear all" brings the closed shop back
  await page.getByRole("button", { name: "Filters (1)" }).click();
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(suresh).toBeVisible();
});

test("vendors: Map view (Phase 6) plots real shop markers and opens a profile from one", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Shops" }).click();
  await expect(page.locator(".c-vcard", { hasText: "Sharma Vegetable Store" })).toBeVisible();

  await page.getByRole("button", { name: "Map" }).click();
  await expect(page.locator(".c-map")).toBeVisible();
  await expect(page.locator('.c-map-pin[title="Sharma Vegetable Store"].c-map-pin--open')).toBeVisible();
  await expect(page.locator('.c-map-pin[title="Suresh Kirana Store"].c-map-pin--closed')).toBeVisible();

  await page.locator('.c-map-pin[title="Sharma Vegetable Store"]').click();
  await page.getByRole("button", { name: "View shop" }).click();
  await expect(page).toHaveURL(/\/v\/SHARMA001/i);
  await expect(page.getByTestId("vendor-name")).toHaveText("Sharma Vegetable Store");
});

test("vendors: profile tabs — Products lists real listings with working Add to cart (Phase 8), About shows real shop details", async ({ page }) => {
  await toHome(page);
  await page.goto("/v/SHARMA001");
  await expect(page.getByTestId("vendor-name")).toBeVisible();

  // Products is the default tab, and now (Phase 8) shows the shop's real listings, not a placeholder.
  await expect(page.getByRole("tab", { name: "Products", selected: true })).toBeVisible();
  const tomatoRow = page.locator(".c-result", { hasText: "Tomato" });
  await expect(tomatoRow).toContainText("₹40");
  await tomatoRow.getByRole("button", { name: "Add to cart" }).click();
  await expect(tomatoRow.getByText("Added ✓")).toBeVisible();

  await page.getByRole("tab", { name: "About" }).click();
  await expect(page.getByText("Vegetables")).toBeVisible();
  await expect(page.getByText("Pickup available")).toBeVisible();
});
