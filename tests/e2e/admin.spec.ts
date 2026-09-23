import { expect, test } from "@playwright/test";
import { enterDevOtp } from "./helpers";

const ADMIN_PHONE = process.env.E2E_ADMIN_PHONE ?? "9000000001";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-123";

test("admin: password + OTP → admin session", async ({ page }) => {
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
  await page.getByRole("link", { name: "Vendor verification" }).click();
  await expect(page.getByRole("heading", { name: "Vendor verification" })).toBeVisible();
});
