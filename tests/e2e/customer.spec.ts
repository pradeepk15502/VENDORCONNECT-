import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone } from "./helpers";

test("customer: language → intro → location → signup → home → profile → logout", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/welcome\/language/);

  // Hindi first to prove translation, then switch to English
  await page.getByRole("radio", { name: /हिन्दी/ }).click();
  await expect(page.getByRole("heading", { name: "अपनी भाषा चुनें" })).toBeVisible();
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Search what you need" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // GPS denied in this browser context → manual city pick
  await expect(page.getByRole("heading", { name: "Where are you?" })).toBeVisible();
  await page.getByRole("button", { name: "Choose area manually" }).click();
  await page.getByRole("button", { name: /Gurugram/ }).click();

  // login
  await expect(page.getByRole("heading", { name: "Enter your mobile number" })).toBeVisible();
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("Enter a valid 10-digit mobile number.")).toBeVisible(); // validation
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel(/Your name/).fill("Asha Verma");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Enter the code" })).toBeVisible();
  await enterDevOtp(page); // auto-submits at 6 digits

  // home with real categories from the API
  await expect(page.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vegetables" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Gurugram/ })).toBeVisible();
  await expect(page.getByText("No nearby vendors found yet.")).toBeVisible();

  // session survives reload (refresh cookie → new access token)
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();

  // bottom nav + empty states
  await page.getByRole("link", { name: "Cart" }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();

  // profile: language switch persists to account, logout
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByTestId("profile-name")).toHaveText("Asha Verma");
  await page.getByRole("button", { name: "हिन्दी" }).click();
  await expect(page.getByRole("link", { name: "प्रोफ़ाइल" })).toBeVisible();
  await page.getByRole("button", { name: "लॉग आउट" }).click();
  await expect(page.getByRole("button", { name: "कोड भेजें" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "कोड भेजें" })).toBeVisible(); // still logged out after reload
});

test("customer: unknown vendor ID deep link shows a helpful empty state", async ({ page }) => {
  await page.goto("/v/@NOSUCH999");
  await expect(page.getByText("@NOSUCH999")).toBeVisible();
});
