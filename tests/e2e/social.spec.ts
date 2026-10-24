import { expect, test, type Page } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 9 (Following, Posts, Reviews) end to end against the demo data seeded by
 * run-stack.sh: Sharma Vegetable Store (@SHARMA001, owner phone +919990000001, "Tomato" ₹40/kg)
 * and Suresh Kirana Store (@SURESH001, owner phone +919990000002) as a second, unrelated vendor
 * for the authorization check. Mirrors orders.spec.ts's login-helper pattern. */

test.use({ geolocation: { latitude: 28.4598, longitude: 77.027 }, permissions: ["geolocation"] });

// A minimal, genuinely valid 1x1 PNG — real image bytes, since the backend decodes every upload
// with Pillow rather than trusting the declared content type (ARCHITECTURE D30).
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

async function addToCart(page: Page, handle: string, listingName: string) {
  await page.goto(`/v/${handle}`);
  await expect(page.getByTestId("vendor-name")).toBeVisible();
  const row = page.locator(".c-result", { hasText: listingName });
  await row.getByRole("button", { name: "Add to cart" }).click();
  await expect(row.getByText("Added ✓")).toBeVisible();
}

/** Places and completes a real pickup order against SHARMA001 (Tomato), returning the order id —
 * the only path Reviews can be written from (a review must be tied to a genuine completed order,
 * master prompt's own "no unlimited fake reviews" rule). */
async function completeOrder(page: Page, vpage: Page, name: string): Promise<string> {
  await addToCart(page, "SHARMA001", "Tomato");
  await page.goto("/cart");
  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/checkout\//);
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  const orderId = page.url().split("/orders/")[1];

  await vpage.goto("/vendor/orders");
  const row = vpage.locator(".c-order-card", { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(vpage).toHaveURL(new RegExp(`/vendor/orders/${orderId}$`));
  await vpage.getByRole("button", { name: "Accept" }).click();
  await vpage.getByRole("button", { name: "Start preparing" }).click();
  await vpage.getByRole("button", { name: "Mark ready" }).click();
  await vpage.getByRole("button", { name: "Mark picked up" }).click();
  await vpage.getByRole("button", { name: "Mark completed" }).click();
  await expect(vpage.getByText("Completed ✓")).toBeVisible();

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText("Completed ✓")).toBeVisible();
  return orderId;
}

test("customer follows a vendor, sees it under Following, then unfollows", async ({ page }) => {
  const name = "Anita Follow";
  await customerHome(page, name);
  await page.goto("/v/SHARMA001");
  await expect(page.getByTestId("vendor-name")).toBeVisible();

  await page.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();

  // --- shows up under Profile > Following, with a real Unfollow round-trip -----------------------
  // The vendor profile is a detail screen (AppBar + back, like a product page) with no bottom tab
  // bar, so the "Profile" nav link only exists on tab-bar screens like Home — go there first.
  await page.goto("/");
  await page.getByRole("link", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Following" }).click();
  await expect(page).toHaveURL(/\/following$/);
  const row = page.locator(".vc-card", { hasText: "Sharma Vegetable Store" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Unfollow" }).click();
  await expect(row).not.toBeVisible();

  // --- the shop profile reflects the unfollow too (state always comes from the server) ------------
  await page.goto("/v/SHARMA001");
  await expect(page.getByRole("button", { name: "Follow" })).toBeVisible();
});

test("vendor creates a post with a real product attached; customer opens it and adds that product to cart", async ({ page, browser }) => {
  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await vendorDashboard(vpage, "9990000001");

  await vpage.goto("/vendor/posts/new");
  await vpage.getByRole("button", { name: "New Stock" }).click();
  const fileInput = vpage.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "tomato.png", mimeType: "image/png", buffer: TEST_PNG });
  await expect(vpage.locator(".soc-composer__thumb img")).toBeVisible();
  const caption = `Fresh tomatoes just in (${Date.now()})`;
  await vpage.getByLabel("Caption (optional)").fill(caption);
  await vpage.getByLabel("Link a product (optional)").selectOption({ label: "Tomato" });
  await vpage.getByRole("button", { name: "Publish post" }).click();
  await expect(vpage).toHaveURL(/\/vendor\/posts$/);
  await expect(vpage.getByText(caption)).toBeVisible();

  // --- a different, logged-in customer opens the shop's Posts tab, then the post itself -----------
  const name = "Kabir Post";
  await customerHome(page, name);
  await page.goto("/v/SHARMA001");
  await page.getByRole("tab", { name: "Posts" }).click();
  const card = page.locator(".soc-postcard", { hasText: caption });
  await expect(card).toBeVisible();
  await card.locator(".soc-postcard__media").click();
  await expect(page).toHaveURL(/\/posts\//);
  await expect(page.getByText(caption)).toBeVisible();

  // --- "View Product" is a real link to the product page, where Add to cart is the real cart -------
  await page.getByRole("button", { name: "View Product" }).click();
  await expect(page).toHaveURL(/\/listings\//);
  await expect(page.getByRole("heading", { name: "Tomato" })).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added ✓")).toBeVisible();

  await vendorCtx.close();
});

test("customer reviews a completed order; the review appears on the shop's public Reviews tab", async ({ page, browser }) => {
  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await vendorDashboard(vpage, "9990000001");

  const name = "Meera Review";
  await customerHome(page, name);
  const orderId = await completeOrder(page, vpage, name);

  await expect(page.getByText(`How was your experience with Sharma Vegetable Store?`)).toBeVisible();
  await page.getByRole("radio", { name: "5" }).click();
  const reviewText = `Great quality, fast pickup (${Date.now()})`;
  await page.getByLabel("Your review (optional)").fill(reviewText);
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText("Thanks for your review!")).toBeVisible();

  // --- reloading no longer offers the form again (one review per order — no unlimited reviews) ----
  await page.reload();
  await expect(page.getByText("Thanks for your review!")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit review" })).not.toBeVisible();

  // --- a duplicate review attempt against the same order is rejected server-side, not just hidden -
  // (covered at the API level by the backend test suite; here we only assert the UI never re-offers it)

  await page.goto("/v/SHARMA001");
  await page.getByRole("tab", { name: "Reviews" }).click();
  await expect(page.getByText(reviewText)).toBeVisible();
  await expect(page.locator(".soc-review", { hasText: reviewText })).toContainText("Verified Purchase");

  // orderId only needed to keep completeOrder's return value meaningful for future extensions
  expect(orderId).toBeTruthy();

  await vendorCtx.close();
});

test("vendor replies to a review; the reply shows publicly and the vendor cannot reply twice", async ({ page, browser }) => {
  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await vendorDashboard(vpage, "9990000001");

  const name = "Divya Reply";
  await customerHome(page, name);
  await completeOrder(page, vpage, name);
  await page.getByRole("radio", { name: "4" }).click();
  const reviewText = `Good but a bit slow (${Date.now()})`;
  await page.getByLabel("Your review (optional)").fill(reviewText);
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText("Thanks for your review!")).toBeVisible();

  // --- vendor finds the review under Reviews and replies -------------------------------------------
  await vpage.goto("/vendor/reviews");
  const row = vpage.locator(".soc-review", { hasText: reviewText });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Reply" }).click();
  const replyText = "Thanks for the feedback — we're working on faster pickup!";
  await row.getByLabel("Your reply").fill(replyText);
  await row.getByRole("button", { name: "Post reply" }).click();
  await expect(row).toContainText(replyText);
  // once replied, the Reply action is gone (one reply per review)
  await expect(row.getByRole("button", { name: "Reply" })).not.toBeVisible();

  // --- the reply is publicly visible on the shop's Reviews tab, not just to the vendor -------------
  await page.goto("/v/SHARMA001");
  await page.getByRole("tab", { name: "Reviews" }).click();
  await expect(page.locator(".soc-review", { hasText: reviewText })).toContainText(replyText);

  await vendorCtx.close();
});

test("authorization: a vendor cannot edit or delete another vendor's post, and never sees it in their own list", async ({ page, browser }) => {
  // --- Sharma (vendor A) publishes a post ----------------------------------------------------------
  const aCtx = await browser.newContext({ ...test.info().project.use });
  const apage = await aCtx.newPage();
  await vendorDashboard(apage, "9990000001");
  await apage.goto("/vendor/posts/new");
  await apage.getByRole("button", { name: "Update" }).click();
  const fileInput = apage.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "shop.png", mimeType: "image/png", buffer: TEST_PNG });
  const caption = `Sharma-only update (${Date.now()})`;
  await apage.getByLabel("Caption (optional)").fill(caption);
  await apage.getByRole("button", { name: "Publish post" }).click();
  await expect(apage).toHaveURL(/\/vendor\/posts$/);
  await expect(apage.getByText(caption)).toBeVisible();

  // grab the post id from the public posts tab, since My Posts doesn't expose it in the URL — this
  // is a fresh, no-language/role-chosen browsing context, exactly like someone opening a shared link
  await page.goto("/v/SHARMA001");
  await skipSplash(page);
  await page.getByRole("tab", { name: "Posts" }).click();
  await page.locator(".soc-postcard", { hasText: caption }).locator(".soc-postcard__media").click();
  await expect(page).toHaveURL(/\/posts\/(.+)$/);
  const sharedPostId = page.url().split("/posts/")[1];

  // --- Suresh (vendor B, unrelated) never sees Sharma's post in their own management list ----------
  const bCtx = await browser.newContext({ ...test.info().project.use });
  const bpage = await bCtx.newPage();
  await vendorDashboard(bpage, "9990000002");
  await bpage.goto("/vendor/posts");
  await expect(bpage.getByText(caption)).not.toBeVisible();

  // --- and a direct attempt to save an edit to it is rejected, not silently applied -----------------
  await bpage.goto(`/vendor/posts/${sharedPostId}/edit`);
  await bpage.getByLabel("Caption (optional)").fill("Hijacked caption attempt");
  await bpage.getByRole("button", { name: "Save" }).click();
  // still on the edit screen — the write was rejected, never redirected to /vendor/posts as success does
  await expect(bpage).toHaveURL(new RegExp(`/vendor/posts/${sharedPostId}/edit$`));

  // the caption on the real, public post is untouched by the rejected attempt
  await page.goto(`/posts/${sharedPostId}`);
  await expect(page.getByText(caption)).toBeVisible();
  await expect(page.getByText("Hijacked caption attempt")).not.toBeVisible();

  // --- nor can vendor B delete it — the post is still there afterwards -----------------------------
  await bpage.goto(`/vendor/posts/${sharedPostId}/edit`);
  await bpage.getByRole("button", { name: "Delete" }).click();
  await bpage.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(bpage).toHaveURL(new RegExp(`/vendor/posts/${sharedPostId}/edit$`));
  await page.goto(`/posts/${sharedPostId}`);
  await expect(page.getByText(caption)).toBeVisible();

  // --- a plain customer role can't even reach the vendor "create post" screen ------------------------
  const cCtx = await browser.newContext({ ...test.info().project.use });
  const cpage = await cCtx.newPage();
  await customerHome(cpage, "Rohit Guard");
  await cpage.goto("/vendor/posts/new");
  await expect(cpage).toHaveURL("/");

  await aCtx.close();
  await bCtx.close();
  await cCtx.close();
});
