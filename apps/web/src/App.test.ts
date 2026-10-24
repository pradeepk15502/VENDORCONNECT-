import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./App";

describe("safeInternalPath", () => {
  it.each(["/profile", "/v/@SHARMA001", "/search?q=tomato"])("allows %s", (p) => expect(safeInternalPath(p)).toBe(p));
  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", undefined])("blocks %s", (p) =>
    expect(safeInternalPath(p)).toBe("/"),
  );
});
