import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 2 (/search) against the demo data seeded by run-stack.sh (seed_demo): two shops
 * near the Gurugram pick in apps/web's CITIES list — Sharma (open, in stock, ~50 m away) and Suresh
 * (closed, out of stock, ~2 km away) both sell tomatoes, so ranking is observable end to end. */

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

test("search: category tile shows nearby listings ranked open/in-stock first", async ({ page }) => {
  await toHome(page);
  await page.getByRole("button", { name: "Vegetables" }).click();
  await expect(page).toHaveURL(/\/search\?category=vegetables/);
  await expect(page.getByText(/results near you/)).toBeVisible();

  const cards = page.locator(".c-result");
  await expect(cards.first()).toContainText("Tomato");
  await expect(cards.first()).toContainText("Sharma Vegetable Store");
  await expect(cards.first().getByText("Open", { exact: true })).toBeVisible();
});

test("search: Hindi-transliterated query finds the product and ranks the open shop first", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Search", { exact: true }).fill("tamatar");
  await expect(page.getByText("2 results near you")).toBeVisible();

  const cards = page.locator(".c-result");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Sharma Vegetable Store");
  await expect(cards.nth(0).getByText("Open", { exact: true })).toBeVisible();
  await expect(cards.nth(1)).toContainText("Suresh Kirana Store");
  await expect(cards.nth(1).getByText("Closed", { exact: true })).toBeVisible();
});

test("search: typing a Vendor ID shows a shop-found card that opens the vendor profile", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Search", { exact: true }).fill("@SHARMA001");
  await expect(page.getByRole("heading", { name: "Shop found" })).toBeVisible();
  await page.getByRole("button", { name: /Sharma Vegetable Store/ }).click();
  await expect(page).toHaveURL(/\/v\/SHARMA001/i);
  await expect(page.getByTestId("vendor-name")).toHaveText("Sharma Vegetable Store");
});

test("search: unrelated text shows the no-results empty state", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Search", { exact: true }).fill("zzznonsensequery");
  await expect(page.getByText("No results found")).toBeVisible();
});

test("search: Open now filter (Phase 6) narrows real results, not just the UI", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Search", { exact: true }).fill("tamatar");
  await expect(page.getByText("2 results near you")).toBeVisible();

  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
  await page.getByRole("button", { name: "Open now" }).click();
  await page.getByRole("button", { name: "Show results" }).click();

  // a real GET /search?open_now=true round trip, not a client-side re-filter of the same page
  await expect(page).toHaveURL(/open_now=1/);
  await expect(page.getByText("1 results near you")).toBeVisible();
  const cards = page.locator(".c-result");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Sharma Vegetable Store");
  await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();

  // "Clear all" goes back to the unfiltered result set
  await page.getByRole("button", { name: "Filters (1)" }).click();
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByText("2 results near you")).toBeVisible();
});

test("search: Map view (Phase 6) plots real shop markers and opens a profile from one", async ({ page }) => {
  await toHome(page);
  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Search", { exact: true }).fill("tamatar");
  await expect(page.getByText("2 results near you")).toBeVisible();

  await page.getByRole("button", { name: "Map" }).click();
  await expect(page.locator(".c-map")).toBeVisible();
  // one marker per shop, styled by real open/closed status, not by a hardcoded look
  await expect(page.locator('.c-map-pin[title="Sharma Vegetable Store"].c-map-pin--open')).toBeVisible();
  await expect(page.locator('.c-map-pin[title="Suresh Kirana Store"].c-map-pin--closed')).toBeVisible();

  await page.locator('.c-map-pin[title="Sharma Vegetable Store"]').click();
  await page.getByRole("button", { name: "View shop" }).click();
  await expect(page).toHaveURL(/\/v\/SHARMA001/i);
  await expect(page.getByTestId("vendor-name")).toHaveText("Sharma Vegetable Store");
});
