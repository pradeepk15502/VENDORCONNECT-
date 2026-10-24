import { expect, type Page } from "@playwright/test";

export const randomPhone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

/** Dismisses the one-time brand splash shown at the start of each browser session. */
export async function skipSplash(page: Page) {
  const splash = page.locator(".vc-splash");
  await expect(splash).toBeVisible();
  await splash.click();
  await expect(splash).not.toBeVisible();
}

/** Reads the dev-mode OTP shown by the app (only exists when the API runs with OTP_DEV_ECHO). */
export async function enterDevOtp(page: Page) {
  const banner = page.getByTestId("dev-otp");
  await expect(banner).toBeVisible();
  const code = (await banner.textContent())!.match(/\d{6}/)![0];
  await page.getByLabel(/6-digit code/i).fill(code);
  return code;
}

/**
 * Picks a role on the "How do you want to use VendorConnect?" screen, shown once per device right
 * after language. VendorConnect is a single app — this just tells the shared shell which half of
 * it to route into next (see ARCHITECTURE D4/D20).
 */
export async function selectRole(page: Page, role: "customer" | "vendor") {
  await page.getByTestId(`role-${role}`).click();
}
