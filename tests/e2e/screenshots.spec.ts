import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Not part of CI: `SHOTS=1` captures docs/screenshots for design review. */
test.skip(!process.env.SHOTS, "screenshots only on demand");
test.use({ geolocation: { latitude: 28.4601, longitude: 77.0268 }, permissions: ["geolocation"] });
const out = (n: string) => `docs/screenshots/${n}.png`;

// A minimal, genuinely valid 1x1 PNG for the Phase 9 post-composer capture below — real image bytes,
// since the backend decodes every upload with Pillow rather than trusting the declared content type.
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("capture", async ({ page, browser }) => {
  // one app: vendor journey first, in Hindi
  await page.goto("http://localhost:4173/");
  await expect(page.locator(".vc-splash")).toBeVisible();
  await page.screenshot({ path: out("00-splash") });
  await skipSplash(page);
  await page.screenshot({ path: out("01-language") });
  await page.getByRole("radio", { name: /हिन्दी/ }).click();
  await page.getByRole("button", { name: "आगे बढ़ें" }).click();

  // single role-selection screen, shared by both journeys
  await expect(page.getByRole("heading", { name: "आप VendorConnect का उपयोग कैसे करना चाहते हैं?" })).toBeVisible();
  await page.screenshot({ path: out("01b-role-select") });
  await selectRole(page, "vendor");

  await page.getByLabel("मोबाइल नंबर").fill(randomPhone());
  await page.getByRole("button", { name: "कोड भेजें" }).click();
  await expect(page.getByTestId("dev-otp")).toBeVisible();
  await page.screenshot({ path: out("02-otp-hindi") });
  const code = (await page.getByTestId("dev-otp").textContent())!.match(/\d{6}/)![0];
  await page.getByLabel(/6 अंकों का कोड/).fill(code);
  const shopName = `Shots${Date.now().toString().slice(-4)} General Store`;
  await page.getByLabel("दुकान का नाम").fill(shopName);
  await page.getByRole("button", { name: "आगे", exact: true }).click();
  await page.getByRole("button", { name: "किराना" }).click();
  await page.getByRole("button", { name: "दूध और अंडे" }).click();
  await page.screenshot({ path: out("03-vendor-categories") });
  await page.getByRole("button", { name: "आगे", exact: true }).click();
  await page.getByRole("button", { name: /GPS/ }).click();
  await page.getByLabel("दुकान का पता").fill("Main Road, Sector 15");
  await page.getByLabel("शहर").fill("Gurugram");
  await page.getByRole("button", { name: "मेरी दुकान बनाएँ" }).click();
  await expect(page.getByTestId("vendor-id")).toBeVisible();
  const handle = (await page.getByTestId("vendor-id").textContent())!.slice(1);
  await page.screenshot({ path: out("04-vendor-id") });
  await page.getByRole("button", { name: "मेरी दुकान पर जाएँ" }).click();
  await expect(page.getByTestId("shop-state")).toBeVisible();
  await page.screenshot({ path: out("05-vendor-dashboard-closed"), fullPage: true });
  await page.getByRole("button", { name: "दुकान खोलें" }).click();
  await expect(page.getByTestId("shop-state")).toHaveText("खुली है");
  await page.screenshot({ path: out("06-vendor-dashboard-open") });
  await page.getByRole("link", { name: "दुकान" }).click();
  await expect(page.getByText("व्यवसाय दस्तावेज़")).toBeVisible();
  await page.screenshot({ path: out("06b-vendor-shop-settings") });

  // Phase 9: this vendor publishes a real post (real uploaded image, no fake data) — the customer
  // journey below views it on this same shop's Posts tab.
  await page.goto("http://localhost:4173/vendor/posts/new");
  await expect(page.getByRole("heading", { name: "पोस्ट बनाएँ" })).toBeVisible();
  await page.getByRole("button", { name: "अपडेट" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: TEST_PNG });
  await expect(page.locator(".soc-composer__thumb img")).toBeVisible();
  await page.getByLabel("कैप्शन (वैकल्पिक)").fill("आज ताज़ा माल आया है!");
  await page.screenshot({ path: out("06c-vendor-create-post") });
  await page.getByRole("button", { name: "पोस्ट प्रकाशित करें" }).click();
  await expect(page).toHaveURL(/\/vendor\/posts$/);
  await page.screenshot({ path: out("06d-vendor-my-posts") });
  await page.goto("http://localhost:4173/vendor/reviews");
  await expect(page.getByText("अभी तक कोई समीक्षा नहीं")).toBeVisible(); // honest empty state — no completed orders yet
  await page.screenshot({ path: out("06e-vendor-reviews-empty") });

  // customer journey, separate session (fresh splash/language/role), in English
  const c = await browser.newContext({ ...test.info().project.use });
  const p = await c.newPage();
  await p.goto("http://localhost:4173/");
  await skipSplash(p);
  await p.getByRole("radio", { name: /English/ }).click();
  await p.getByRole("button", { name: "Continue" }).click();
  await expect(p.getByRole("heading", { name: "How do you want to use VendorConnect?" })).toBeVisible();
  await selectRole(p, "customer");
  await p.screenshot({ path: out("07-customer-intro") });
  await p.getByRole("button", { name: "Skip" }).click();
  await p.screenshot({ path: out("07b-customer-location") });
  await p.getByRole("button", { name: "Choose area manually" }).click();
  await p.getByRole("button", { name: /Gurugram/ }).click();
  await p.getByLabel("Mobile number").fill(randomPhone());
  await p.getByLabel(/Your name/).fill("Asha");
  await p.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(p);
  await expect(p.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();
  await p.screenshot({ path: out("08-customer-home"), fullPage: true });
  await p.getByRole("button", { name: "Vegetables" }).click();
  await expect(p.getByText(/results near you/)).toBeVisible();
  await p.screenshot({ path: out("08b-customer-search-results"), fullPage: true });
  await p.getByRole("link", { name: "Shops" }).click();
  await expect(p.getByRole("heading", { name: /shops near you/ })).toBeVisible();
  await p.screenshot({ path: out("08c-customer-vendors-tab"), fullPage: true });
  await p.goto(`http://localhost:4173/v/${handle.toLowerCase()}`);
  await expect(p.getByTestId("vendor-name")).toBeVisible();
  await p.screenshot({ path: out("09-customer-vendor-link") });
  await p.getByRole("tab", { name: "About" }).click();
  await p.screenshot({ path: out("09b-customer-vendor-about") });

  // Phase 9: this shop's real post (published by its vendor above) on the public Posts tab, then
  // following the shop — both states come from the server, never guessed client-side.
  await p.getByRole("tab", { name: "Posts" }).click();
  await expect(p.locator(".soc-postcard")).toBeVisible();
  await p.screenshot({ path: out("09c-customer-vendor-posts-tab") });
  await p.getByRole("button", { name: "Follow" }).click();
  await expect(p.getByRole("button", { name: "Following" })).toBeVisible();
  await p.screenshot({ path: out("09d-customer-vendor-following-state") });
  // the vendor profile is a detail screen with no bottom tab bar — go home first to reach it
  await p.goto("http://localhost:4173/");
  await p.getByRole("link", { name: "Profile" }).click();
  await p.getByRole("button", { name: "Following" }).click();
  await expect(p).toHaveURL(/\/following$/);
  await p.screenshot({ path: out("09e-customer-following-list") });

  await p.goto("http://localhost:4173/notifications");
  // exact: true — a fresh account's real "No notifications yet" empty-state heading otherwise also
  // matches this substring, making the locator ambiguous.
  await expect(p.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await p.screenshot({ path: out("10-customer-notifications") });

  // Phase 8: cart → checkout → order tracking → order history, using the seeded Sharma shop (the
  // vendor created earlier in this same run has no listings of its own to add to a cart).
  await p.goto("http://localhost:4173/v/SHARMA001");
  await expect(p.getByTestId("vendor-name")).toBeVisible();
  await p.locator(".c-result", { hasText: "Tomato" }).getByRole("button", { name: "Add to cart" }).click();
  await p.goto("http://localhost:4173/cart");
  await expect(p.locator(".c-cart-row")).toBeVisible();
  await p.screenshot({ path: out("11-customer-cart"), fullPage: true });
  await p.getByRole("button", { name: "Checkout" }).click();
  await expect(p).toHaveURL(/\/checkout\//);
  await expect(p.getByRole("button", { name: "Place order" })).toBeVisible();
  await p.screenshot({ path: out("12-customer-checkout"), fullPage: true });
  await p.getByRole("button", { name: "Place order" }).click();
  await expect(p).toHaveURL(/\/orders\/[^/]+$/);
  await p.screenshot({ path: out("13-customer-order-tracking"), fullPage: true });
  const orderId = p.url().split("/orders/")[1];
  await p.goto("http://localhost:4173/orders");
  await expect(p.getByRole("heading", { name: "My orders" })).toBeVisible();
  await p.screenshot({ path: out("14-customer-order-history") });
  await c.close();

  // Sharma's own vendor session (separate context, dev-OTP into the existing seeded account) works
  // the order the customer just placed — captures the vendor order queue and detail screens.
  const sc = await browser.newContext({ ...test.info().project.use });
  const sp = await sc.newPage();
  await sp.goto("http://localhost:4173/");
  await skipSplash(sp);
  await sp.getByRole("radio", { name: /English/ }).click();
  await sp.getByRole("button", { name: "Continue" }).click();
  await selectRole(sp, "vendor");
  await sp.getByLabel("Mobile number").fill("9990000001");
  await sp.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(sp);
  await expect(sp).toHaveURL(/\/vendor$/);
  await sp.goto("http://localhost:4173/vendor/orders");
  await expect(sp.getByRole("heading", { name: "Orders" })).toBeVisible();
  await sp.screenshot({ path: out("15-vendor-orders-list"), fullPage: true });
  await sp.goto(`http://localhost:4173/vendor/orders/${orderId}`);
  await expect(sp.getByRole("button", { name: "Accept" })).toBeVisible();
  await sp.screenshot({ path: out("16-vendor-order-detail"), fullPage: true });
  await sc.close();
});
