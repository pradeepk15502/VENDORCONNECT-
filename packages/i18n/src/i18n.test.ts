import { describe, expect, it } from "vitest";
import { en } from "./en";
import { hi } from "./hi";
import { translate } from "./index";

describe("i18n", () => {
  it("interpolates variables", () => {
    expect(translate("en", "auth.resend_in", { s: 12 })).toBe("Resend in 12s");
    expect(translate("hi", "auth.resend_in", { s: 12 })).toBe("12 सेकंड में दोबारा भेजें");
  });
  it("falls back to English for missing Hindi keys", () => {
    expect(translate("hi", "admin.password")).toBe(en["admin.password"]);
  });
  it("Hindi covers every customer/vendor-facing key", () => {
    const missing = Object.keys(en).filter((k) => !k.startsWith("admin.") && k !== "app.name" && !(k in hi));
    expect(missing).toEqual([]);
  });
});
