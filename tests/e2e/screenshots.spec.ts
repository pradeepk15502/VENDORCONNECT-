import { expect, test } from "@playwright/test";
import { enterDevOtp, randomPhone } from "./helpers";

/* Not part of CI: `SHOTS=1` captures docs/screenshots for design review. */
test.skip(!process.env.SHOTS, "screenshots only on demand");
test.use({ geolocation: { latitude: 28.4601, longitude: 77.0268 }, permissions: ["geolocation"] });
const out = (n: string) => `docs/screenshots/${n}.png`;

test("capture", async ({ page, browser }) => {
  // vendor app, in Hindi
  await page.goto("http://localhost:4174/");
  await page.screenshot({ path: out("01-language") });
  await page.getByRole("radio", { name: /हिन्दी/ }).click();
  await page.getByRole("button", { name: "आगे बढ़ें" }).click();
  await page.getByRole("button", { name: "आगे बढ़ें" }).click();
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

  // customer app, in English
  const c = await browser.newContext({ ...test.info().project.use });
  const p = await c.newPage();
  await p.goto("http://localhost:4173/");
  await p.getByRole("radio", { name: /English/ }).click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.screenshot({ path: out("07-customer-intro") });
  await p.getByRole("button", { name: "Skip" }).click();
  await p.getByRole("button", { name: "Choose area manually" }).click();
  await p.getByRole("button", { name: /Gurugram/ }).click();
  await p.getByLabel("Mobile number").fill(randomPhone());
  await p.getByLabel(/Your name/).fill("Asha");
  await p.getByRole("button", { name: "Send code" }).click();
  await enterDevOtp(p);
  await expect(p.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();
  await p.screenshot({ path: out("08-customer-home"), fullPage: true });
  await p.goto(`http://localhost:4173/v/${handle.toLowerCase()}`);
  await expect(p.getByTestId("vendor-name")).toBeVisible();
  await p.screenshot({ path: out("09-customer-vendor-link") });
  await c.close();
});
