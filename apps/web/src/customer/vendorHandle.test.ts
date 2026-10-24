import { describe, expect, it } from "vitest";
import { looksLikeVendorHandle } from "./vendorHandle";

describe("looksLikeVendorHandle", () => {
  it("matches Vendor ID patterns with or without @, case-insensitively, trimmed", () => {
    expect(looksLikeVendorHandle("@SHARMA001")).toBe(true);
    expect(looksLikeVendorHandle("sharma001")).toBe(true);
    expect(looksLikeVendorHandle("  @Sharma001  ")).toBe(true);
    expect(looksLikeVendorHandle("AB123")).toBe(true);
  });

  it("rejects plain product searches", () => {
    expect(looksLikeVendorHandle("tomato")).toBe(false);
    expect(looksLikeVendorHandle("tamatar")).toBe(false);
    expect(looksLikeVendorHandle("")).toBe(false);
    expect(looksLikeVendorHandle("milk 1kg")).toBe(false);
  });
});
