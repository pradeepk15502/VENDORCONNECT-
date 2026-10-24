import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone, selectRole, skipSplash } from "./helpers";

test.use({ geolocation: { latitude: 28.4601, longitude: 77.0268 }, permissions: ["geolocation"] });

test("vendor: language → role → signup → shop setup → Vendor ID → open/close visible to customers", async ({ page, browser }) => {
  await page.goto("/");
  await skipSplash(page);
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // one app, single role-selection step — picking Vendor here routes into the vendor half
  await expect(page.getByRole("heading", { name: "How do you want to use VendorConnect?" })).toBeVisible();
  await selectRole(page, "vendor");

  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel(/Your name/).fill("Ramesh");
  await page.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(page);

  // wizard step 1
  await expect(page.getByRole("heading", { name: "Set up your shop" })).toBeVisible();
  await page.getByLabel("Shop name").fill("Testwala Kirana");
  await page.getByRole("button", { name: "Next" }).click();
  // step 2: validation then choose categories
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Choose up to 5.").last()).toBeVisible();
  await page.getByRole("button", { name: "Vegetables" }).click();
  await page.getByRole("button", { name: "Grocery" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  // step 3: location via (mocked) GPS
  await page.getByRole("button", { name: "Create my shop" }).click();
  await expect(page.getByText("Please capture your shop location.")).toBeVisible();
  await page.getByRole("button", { name: /use GPS/ }).click();
  await expect(page.getByTestId("coords")).toContainText("28.4601");
  await page.getByLabel("Shop address").fill("Shop 4, Sector 14 Market");
  await page.getByLabel("City").fill("Gurugram");
  await page.getByLabel("PIN code").fill("122001");
  await page.getByRole("button", { name: "Create my shop" }).click();

  // Vendor ID issued
  await expect(page.getByRole("heading", { name: "Your shop is live!" })).toBeVisible();
  const vendorId = (await page.getByTestId("vendor-id").textContent())!;
  expect(vendorId).toMatch(/^@TESTWALA\d{3}$/);
  await page.getByRole("button", { name: "Go to my shop" }).click();

  // dashboard: starts CLOSED, one tap to open
  await expect(page.getByTestId("shop-state")).toHaveText("CLOSED");
  await page.getByRole("button", { name: "Open Shop" }).click();
  await expect(page.getByTestId("shop-state")).toHaveText("OPEN");

  // a customer (separate browser context, customer app) sees it immediately via the deep link
  const customer = await browser.newContext({ ...test.info().project.use });
  const cpage = await customer.newPage();
  await cpage.goto(`http://localhost:4173/v/${vendorId.toLowerCase()}`);
  await skipSplash(cpage);
  await expect(cpage.getByTestId("vendor-name")).toHaveText("Testwala Kirana");
  await expect(cpage.getByText("Open", { exact: true })).toBeVisible();
  await expect(cpage.getByText("Pickup only")).toBeVisible();

  // close shop → customer sees Closed on reload
  await page.getByRole("button", { name: "Close Shop" }).click();
  await expect(page.getByTestId("shop-state")).toHaveText("CLOSED");
  await cpage.reload();
  await expect(cpage.getByText("Closed", { exact: true })).toBeVisible();
  await customer.close();

  // state persisted server-side
  await page.reload();
  await expect(page.getByTestId("shop-state")).toHaveText("CLOSED");
});
