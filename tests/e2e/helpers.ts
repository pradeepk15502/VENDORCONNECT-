import { expect, type Page } from "@playwright/test";

export const randomPhone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

/** Reads the dev-mode OTP shown by the app (only exists when the API runs with OTP_DEV_ECHO). */
export async function enterDevOtp(page: Page) {
  const banner = page.getByTestId("dev-otp");
  await expect(banner).toBeVisible();
  const code = (await banner.textContent())!.match(/\d{6}/)![0];
  await page.getByLabel(/6-digit code/i).fill(code);
  return code;
}
