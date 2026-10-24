import { expect, test, type Page } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

/* Exercises Phase 7 (chat) end to end against the demo data seeded by run-stack.sh: Sharma
 * Vegetable Store (owner phone +919990000001, an existing account — dev OTP logs straight into it,
 * same as any other phone) with a real "tomato" listing to share. A fresh random-phone customer
 * starts the conversation, exactly as vendors.spec.ts's map test starts from the same seeded shop. */

async function customerHome(page: Page, name = "Asha") {
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
  await expect(page.getByRole("heading", { name: `Hello, ${name}` })).toBeVisible();
}

/** Logs into Sharma's existing vendor account (seeded by seed_demo) — an ordinary dev-OTP login,
 * no name needed since the account already exists. */
async function sharmaVendorDashboard(page: Page) {
  await page.goto("/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await selectRole(page, "vendor");
  await page.getByLabel("Mobile number").fill("9990000001");
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);
  await expect(page).toHaveURL(/\/vendor$/);
}

test("chat: customer messages a shop, vendor replies with a quick reply and shares a product, block/unblock is enforced", async ({ page, browser }) => {
  const unique = `E2E quick reply ${Date.now()}`;
  const question = `Do you have fresh tomatoes? (${Date.now()})`;

  // --- customer starts the conversation from the shop's profile -----------------------------
  await customerHome(page);
  await page.goto("/v/SHARMA001");
  await expect(page.getByTestId("vendor-name")).toBeVisible();
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.getByRole("heading", { name: "Sharma Vegetable Store" })).toBeVisible();

  await page.getByLabel("Type a message").fill(question);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(question)).toBeVisible();

  // --- vendor (separate browser context) sees it and replies -------------------------------
  const vendorCtx = await browser.newContext({ ...test.info().project.use });
  const vpage = await vendorCtx.newPage();
  await sharmaVendorDashboard(vpage);
  await vpage.getByRole("link", { name: "Messages" }).click();
  const row = vpage.locator(".chat-row", { hasText: "Asha" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(vpage.getByText(question)).toBeVisible();

  // add (or reuse) a quick reply, then send it
  await vpage.getByRole("button", { name: "Manage quick replies" }).click();
  await expect(vpage.getByRole("dialog")).toBeVisible();
  await vpage.getByLabel("Add a quick reply").fill(unique);
  await vpage.getByRole("dialog").getByRole("button", { name: "Add" }).click();
  await expect(vpage.getByRole("dialog").getByText(unique)).toBeVisible();
  await vpage.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await vpage.getByRole("button", { name: unique }).click();
  await expect(vpage.locator(".chat-bubble", { hasText: unique })).toBeVisible();

  // vendor shares a real listing (Tomato, seeded by seed_demo)
  await vpage.getByRole("button", { name: "Share a product" }).click();
  await expect(vpage.getByRole("dialog")).toBeVisible();
  await vpage.getByRole("dialog").locator(".c-listbtn", { hasText: "Tomato" }).click();
  await expect(vpage.locator(".chat-bubble__product-name", { hasText: "Tomato" })).toBeVisible();

  // --- customer sees the reply and the shared product via short polling --------------------
  await expect(page.getByText(unique)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-bubble__product-name", { hasText: "Tomato" })).toBeVisible({ timeout: 10_000 });

  // --- customer reports the conversation ----------------------------------------------------
  await page.getByRole("button", { name: "Report" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report received. Our team will review it.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  // --- vendor blocks the customer; the customer can no longer send after reloading ----------
  // ("Block" is a substring of "Unblock", so every exact-"Block" lookup below is pinned with
  // `exact: true` to avoid matching the other button once both can be on screen)
  await vpage.getByRole("button", { name: "Block", exact: true }).click();
  await expect(vpage.getByRole("dialog")).toBeVisible();
  await vpage.getByRole("dialog").getByRole("button", { name: "Block", exact: true }).click();
  await expect(vpage.getByRole("button", { name: "Unblock" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("You can no longer send messages in this conversation.")).toBeVisible();
  await expect(page.getByLabel("Type a message")).toBeDisabled();

  // --- vendor unblocks; the customer can send again -----------------------------------------
  await vpage.getByRole("button", { name: "Unblock" }).click();
  await expect(vpage.getByRole("dialog")).toBeVisible();
  await vpage.getByRole("dialog").getByRole("button", { name: "Unblock" }).click();
  await expect(vpage.getByRole("button", { name: "Block", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Type a message")).toBeEnabled();
  await page.getByLabel("Type a message").fill("Great, thank you!");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Great, thank you!")).toBeVisible();

  // --- clean up the quick reply so repeated local (non-CI) runs never hit the 20-reply cap ---
  // (scoped to the row with our own unique text — leftover rows from earlier local runs, if any,
  // are left untouched)
  await vpage.getByRole("button", { name: "Manage quick replies" }).click();
  const dialog = vpage.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator(".chat-qr-row", { hasText: unique }).getByRole("button", { name: "Delete quick reply" }).click();
  await expect(dialog.getByText(unique)).not.toBeVisible();

  await vendorCtx.close();
});
