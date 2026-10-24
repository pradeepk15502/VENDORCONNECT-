import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 10 (AI-assisted product entry) end to end against the real API — real image
 * upload, real OCR (tesseract) / real barcode decode (pyzbar), real taxonomy matching, real
 * VendorProduct creation. No UI-only fake success: every assertion here reflects genuine backend
 * behaviour (see services/api/vc/ai for the provider that actually produces these results).
 *
 * `fixtures/scan-label-tamatar-hybrid.png` is a real, legible label photo (rendered with a real
 * font) that a real OCR pass reads as "TAMATAR HYBRID" — a real alias of the seeded "Tomato"
 * product's "Hybrid" variety. `fixtures/scan-blank.png` is a plain white square: no barcode, no
 * text, nothing for even a real OCR/barcode pass to find — the honest "no confident match" case
 * this provider is expected to report rather than invent a guess for. */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LABEL_IMAGE = path.join(__dirname, "fixtures", "scan-label-tamatar-hybrid.png");
const BLANK_IMAGE = path.join(__dirname, "fixtures", "scan-blank.png");

// Deliberately NOT the 28.4598/77.0270 Gurugram cluster that search.spec.ts / vendors.spec.ts seed
// their fixed "N results near you" assertions against — these tests create a real vendor with a
// real "Tomato" listing (via real OCR), and at that shared location it would legitimately show up
// in those other suites' nearby-search counts (real, correct behaviour, just not what those fixed
// counts expect). Sonipat is ~55 km away, well outside SEARCH_RADIUS_KM_MAX (25 km), so this
// suite's vendors are geographically real but never nearby-searchable from the shared cluster.
test.use({ geolocation: { latitude: 28.9931, longitude: 77.0151 }, permissions: ["geolocation"] });

async function freshVendor(page: Page, shopName: string) {
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
  await page.getByLabel("Shop address").fill("Shop 4, Model Town Market");
  await page.getByLabel("City").fill("Sonipat");
  await page.getByRole("button", { name: "Create my shop" }).click();
  await expect(page.getByRole("heading", { name: "Your shop is live!" })).toBeVisible();
  await page.getByRole("button", { name: "Go to my shop" }).click();
  await expect(page.getByTestId("shop-state")).toBeVisible();
}

async function openScanScreen(page: Page) {
  await page.getByRole("button", { name: "AI Scan Product" }).click();
  await expect(page).toHaveURL(/\/vendor\/products\/scan$/);
}

test("AI scan happy path: real OCR match -> confirm -> real product creation", async ({ page }) => {
  await freshVendor(page, "Scan Happy Path Store");
  await openScanScreen(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Upload Photo" }).click(),
  ]);
  await chooser.setFiles(LABEL_IMAGE);

  await expect(page).toHaveURL(/\/vendor\/products\/scan\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Review scan" })).toBeVisible();
  // a real detection: the label really was matched to the real seeded "Tomato" product
  await expect(page.getByText("Tomato", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Development scanner", { exact: false })).toBeVisible(); // never presented as production AI
  await expect(page.getByText("Market price unavailable", { exact: false })).toBeVisible(); // no market data seeded — honest, not invented

  // the vendor edits the price themselves — the AI never supplies one
  await page.getByLabel("Price").fill("32");
  await page.getByRole("button", { name: "Add Product" }).click();

  // real create -> real edit screen, exactly like a manual add. The edit form loads the price
  // straight from the API's DecimalField (2 places), same as any pre-existing listing would.
  await expect(page).toHaveURL(/\/vendor\/products\/[^/]+\/edit$/);
  await expect(page.getByLabel("Price")).toHaveValue("32.00");

  // edit's Back replaces history at /vendor/products/scan/:id -> /:id/edit, so one Back lands on
  // the scan screen (also nav-less), and a second lands on the dashboard, which has the tab bar.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: "Products" }).click();
  const row = page.locator(".v-prow", { hasText: "Tomato" });
  await expect(row).toBeVisible();
  await expect(row.getByText("₹32")).toBeVisible();
});

test("AI scan: no confident match falls back honestly to manual entry", async ({ page }) => {
  await freshVendor(page, "Scan Fallback Store");
  await openScanScreen(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Upload Photo" }).click(),
  ]);
  await chooser.setFiles(BLANK_IMAGE);

  await expect(page).toHaveURL(/\/vendor\/products\/scan\/[^/]+$/);
  await expect(page.getByText("We couldn't confidently identify this product", { exact: false })).toBeVisible();
  // no fabricated guess, and no editable product form for a non-existent detection
  await expect(page.getByLabel("Price")).not.toBeVisible();

  await page.getByRole("button", { name: "Add manually instead" }).click();
  await expect(page).toHaveURL(/\/vendor\/products\/new$/);
  await expect(page.getByRole("heading", { name: "Add product" })).toBeVisible();
});

test("AI scan: a provider/network failure offers retry and manual entry, never a fake result", async ({ page }) => {
  await freshVendor(page, "Scan Failure Store");
  await openScanScreen(page);

  // Simulate the exact class of failure master prompt §21 requires handling (provider/network
  // failure) at the transport level — the real backend already has its own test coverage for
  // provider exceptions (vc/ai/tests/test_detect.py); this proves the *frontend* never shows a
  // fake success when the request to create the scan itself cannot complete.
  await page.route("**/api/v1/ai/detections", (route) => route.abort("failed"));

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Upload Photo" }).click(),
  ]);
  await chooser.setFiles(LABEL_IMAGE);

  await expect(page).toHaveURL(/\/vendor\/products\/scan$/); // never navigates to a nonexistent detection
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add manually instead" })).toBeVisible();

  await page.unroute("**/api/v1/ai/detections");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/vendor\/products\/scan\/[^/]+$/); // recovers once the network works again
});

test("AI scan: a vendor can never open or confirm another vendor's scan", async ({ page, browser }) => {
  await freshVendor(page, "Scan Owner Store");
  await openScanScreen(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Upload Photo" }).click(),
  ]);
  await chooser.setFiles(LABEL_IMAGE);
  await expect(page).toHaveURL(/\/vendor\/products\/scan\/([^/]+)$/);
  const detectionId = page.url().split("/vendor/products/scan/")[1];

  const otherCtx = await browser.newContext({ ...test.info().project.use });
  const opage = await otherCtx.newPage();
  await freshVendor(opage, "Scan Intruder Store");
  await opage.goto(`/vendor/products/scan/${detectionId}`);
  await expect(opage.getByText("Something went wrong")).toBeVisible();
  await expect(opage.getByLabel("Price")).not.toBeVisible();

  await otherCtx.close();
});
