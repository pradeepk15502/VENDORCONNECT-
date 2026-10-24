import { expect, test, type Page } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 8 (cart, pickup/delivery checkout, and order tracking/management) end to end
 * against the demo data seeded by run-stack.sh: Sharma Vegetable Store (owner phone
 * +919990000001, lat 28.4598/lng 77.0270, open, pickup-only by default per DeliverySettings'
 * own defaults) with a real "Tomato" listing (₹40/kg, in stock), and Suresh Kirana Store (owner
 * phone +919990000002) used only as a second, unrelated vendor for the cross-account access
 * check. Mirrors chat.spec.ts's login-helper pattern. */

test.use({ geolocation: { latitude: 28.4598, longitude: 77.027 }, permissions: ["geolocation"] });

async function customerHome(page: Page, name: string) {
  await page.goto("/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "customer");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Choose area manually" }).click();
  await page.getByRole("button", { name: /Gurugram/ }).click();
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel(/Your name/).fill(name);
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);
  // the home greeting shows only the first word of the name (see HomeScreen.tsx)
  await expect(page.getByRole("heading", { name: `Hello, ${name.split(" ")[0]}` })).toBeVisible();
}

/** Logs into an existing seeded vendor account by phone (dev OTP, no signup wizard involved). */
async function vendorDashboard(page: Page, phone: string) {
  await page.goto("/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "vendor");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);
  await expect(page).toHaveURL(/\/vendor$/);
}

/** Adds one unit of a named listing from a vendor's public profile's Products tab to the cart
 * (Products is that tab's default, so no tab click is needed) — the customer must already be
 * logged in. */
async function addToCart(page: Page, handle: string, listingName: string) {
  await page.goto(`/v/${handle}`);
  await expect(page.getByTestId("vendor-name")).toBeVisible();
  const row = page.locator(".c-result", { hasText: listingName });
  await row.getByRole("button", { name: "Add to cart" }).click();
  await expect(row.getByText("Added ✓")).toBeVisible();
}

test("customer + vendor: pickup order end-to-end (place → accept → preparing → ready → picked up → completed)", async ({ page, browser }) => {
  const name = "Priya Pickup";
  await customerHome(page, name);
  await addToCart(page, "SHARMA001", "Tomato");

  // --- cart: bump quantity to 2, confirm the per-vendor subtotal recalculates -------------------
  await page.goto("/cart"); // the vendor profile page has no bottom nav to click "Cart" from
  const cartRow = page.locator(".c-cart-row").first();
  await expect(cartRow).toBeVisible();
  await cartRow.getByRole("button", { name: "+" }).click();
  await expect(cartRow.getByTestId("cart-qty")).toHaveText("2.00"); // quantities are decimals server-side
  await expect(page.locator(".c-cart-group__subtotal")).toContainText("80");

  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/checkout\//);

  // pickup is selected by default, and is available (Sharma has pickup enabled by seed default)
  await expect(page.locator(".c-checkout__option.is-selected")).toContainText("Pickup");
  await expect(page.locator(".o-items")).toContainText("Tomato");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  await expect(page.getByText("Placed ✓")).toBeVisible();
  const orderId = page.url().split("/orders/")[1];

  // --- vendor (separate browser context) works the order through to completion ------------------
  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await vendorDashboard(vpage, "9990000001");
  await vpage.getByRole("link", { name: "Orders" }).click();
  const row = vpage.locator(".c-order-card", { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(vpage).toHaveURL(new RegExp(`/vendor/orders/${orderId}$`));

  await vpage.getByRole("button", { name: "Accept" }).click();
  await expect(vpage.getByRole("button", { name: "Start preparing" })).toBeVisible();
  await vpage.getByRole("button", { name: "Start preparing" }).click();
  await expect(vpage.getByRole("button", { name: "Mark ready" })).toBeVisible();
  await vpage.getByRole("button", { name: "Mark ready" }).click();
  await expect(vpage.getByRole("button", { name: "Mark picked up" })).toBeVisible();
  await vpage.getByRole("button", { name: "Mark picked up" }).click();
  await expect(vpage.getByRole("button", { name: "Mark completed" })).toBeVisible();
  await vpage.getByRole("button", { name: "Mark completed" }).click();
  await expect(vpage.getByText("Completed ✓")).toBeVisible();

  // --- the order also now shows up under the vendor's History tab, not Active --------------------
  await vpage.goto("/vendor/orders"); // the order-detail screen has no bottom nav to click "Orders" from
  await vpage.getByRole("tab", { name: "History" }).click();
  await expect(vpage.locator(".c-order-card", { hasText: name }).first()).toBeVisible();

  // --- customer reloads the tracking screen and sees the full reached history --------------------
  await page.reload();
  await expect(page.getByText("Accepted ✓")).toBeVisible();
  await expect(page.getByText("Preparing ✓")).toBeVisible();
  await expect(page.getByText("Ready ✓")).toBeVisible();
  await expect(page.getByText("Picked up ✓")).toBeVisible();
  await expect(page.getByText("Completed ✓")).toBeVisible();
  // a completed order can no longer be cancelled
  await expect(page.getByRole("button", { name: "Cancel order" })).not.toBeVisible();

  await vendorCtx.close();
});

test("customer + vendor: delivery order end-to-end (enable delivery → add address → place → accept → preparing → ready → out for delivery → delivered → completed)", async ({ page, browser }) => {
  // --- vendor turns delivery on first: seed_demo leaves every shop pickup-only by default --------
  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await vendorDashboard(vpage, "9990000001");
  await vpage.getByRole("link", { name: "Shop" }).click();
  await vpage.locator(".vc-listrow", { hasText: "Delivery Settings" }).click();
  const deliveryToggle = vpage.locator("label", { hasText: "Offer home delivery" }).locator("input[type=checkbox]");
  if (!(await deliveryToggle.isChecked())) await deliveryToggle.check();
  await vpage.getByRole("button", { name: "Save" }).click();
  await expect(vpage.getByText("Delivery settings updated.")).toBeVisible();

  // --- customer places a delivery order, adding a new address (GPS-mocked to the shop's own spot,
  //     i.e. distance ~0km — comfortably inside the default 3km radius) ---------------------------
  const name = "Priya Delivery";
  await customerHome(page, name);
  await addToCart(page, "SHARMA001", "Tomato");
  await page.goto("/cart"); // the vendor profile page has no bottom nav to click "Cart" from
  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/checkout\//);

  await page.locator(".c-checkout__option", { hasText: "Delivery" }).click();
  await expect(page.locator(".c-checkout__option.is-selected")).toContainText("Delivery");
  await page.getByRole("button", { name: "Add new address" }).click();
  await expect(page).toHaveURL(/\/addresses\/new/);
  await page.getByRole("button", { name: "Use my current location" }).click();
  await expect(page.getByRole("button", { name: "Location captured ✓" })).toBeVisible();
  await page.getByLabel("House / Flat / Street").fill("Shop 12, Sector 14 Market");
  await page.getByLabel("City").fill("Gurugram");
  await page.getByLabel("PIN code").fill("122001");
  await page.getByRole("button", { name: "Save" }).click();

  // back on checkout (fresh mount resets the fulfilment picker to Pickup, so select Delivery again)
  await expect(page).toHaveURL(/\/checkout\//);
  await page.locator(".c-checkout__option", { hasText: "Delivery" }).click();
  await expect(page.locator(".c-checkout__option.is-selected")).toContainText("Delivery");
  await expect(page.getByRole("button", { name: "Place order" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  await expect(page.getByText("Placed ✓")).toBeVisible();
  const orderId = page.url().split("/orders/")[1];
  await expect(page.locator(".o-actions")).toContainText("Directions"); // delivery-address directions link

  // --- same vendor session works the order through delivery-specific transitions ------------------
  await vpage.goto("/vendor/orders");
  const row = vpage.locator(".c-order-card", { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(vpage).toHaveURL(new RegExp(`/vendor/orders/${orderId}$`));
  await expect(vpage.getByText("Sector 14 Market")).toBeVisible();

  await vpage.getByRole("button", { name: "Accept" }).click();
  await vpage.getByRole("button", { name: "Start preparing" }).click();
  await vpage.getByRole("button", { name: "Mark ready" }).click();
  await expect(vpage.getByRole("button", { name: "Mark out for delivery" })).toBeVisible();
  await vpage.getByRole("button", { name: "Mark out for delivery" }).click();
  await expect(vpage.getByRole("button", { name: "Mark delivered" })).toBeVisible();
  await vpage.getByRole("button", { name: "Mark delivered" }).click();
  await expect(vpage.getByRole("button", { name: "Mark completed" })).toBeVisible();
  await vpage.getByRole("button", { name: "Mark completed" }).click();
  await expect(vpage.getByText("Completed ✓")).toBeVisible();

  // --- customer sees the full delivery timeline and the delivery address ---------------------------
  await page.reload();
  await expect(page.getByText("Out for delivery ✓")).toBeVisible();
  await expect(page.getByText("Delivered ✓")).toBeVisible();
  await expect(page.getByText("Completed ✓")).toBeVisible();
  await expect(page.getByText("Sector 14 Market")).toBeVisible();

  await vendorCtx.close();
});

test("vendor: rejects an order with a reason; customer sees why; a different vendor can't open it", async ({ page, browser }) => {
  const name = "Priya Reject";
  await customerHome(page, name);
  await addToCart(page, "SHARMA001", "Tomato");
  await page.goto("/cart"); // the vendor profile page has no bottom nav to click "Cart" from
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  const orderId = page.url().split("/orders/")[1];

  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await vendorDashboard(vpage, "9990000001");
  await vpage.getByRole("link", { name: "Orders" }).click();
  await vpage.locator(".c-order-card", { hasText: name }).first().click();
  await expect(vpage).toHaveURL(new RegExp(`/vendor/orders/${orderId}$`));

  const reason = `Out of stock right now (${Date.now()})`;
  await vpage.getByRole("button", { name: "Reject" }).click();
  const dialog = vpage.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Reject" }).click(); // submit with no reason first…
  await expect(dialog.getByText("Please add a reason.")).toBeVisible(); // …is rejected client-side
  await dialog.locator("label", { hasText: "Reason for rejecting" }).locator("textarea").fill(reason);
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(vpage.getByText("Rejected ✓")).toBeVisible();
  await expect(vpage.getByText(reason)).toBeVisible();

  // --- customer sees the rejection and the reason, and the order is no longer cancellable ---------
  await page.reload();
  await expect(page.getByText("Rejected ✓")).toBeVisible();
  await expect(page.getByText(reason)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel order" })).not.toBeVisible();

  // --- cross-account access control: Suresh (an unrelated vendor) can't open Sharma's order --------
  const otherCtx = await browser.newContext({ ...test.info().project.use });
  const opage = await otherCtx.newPage();
  await vendorDashboard(opage, "9990000002");
  await opage.goto(`/vendor/orders/${orderId}`);
  await expect(opage.getByText("Something went wrong")).toBeVisible();
  await expect(opage.getByRole("button", { name: "Reject" })).not.toBeVisible();

  await vendorCtx.close();
  await otherCtx.close();
});
