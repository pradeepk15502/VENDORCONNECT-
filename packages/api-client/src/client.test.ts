import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  it("stores access token in memory after verify and sends it as Bearer", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: true, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { id: "u" }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    expect(api.token).toBe("A1");
    await api.auth.me();
    const headers = f.mock.calls[1][1].headers;
    expect(headers.Authorization).toBe("Bearer A1");
    expect(headers["X-Requested-With"]).toBe("vendorconnect");
    expect(f.mock.calls[1][1].credentials).toBe("include");
  });

  it("refreshes once on 401 and retries the request", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(401, { error: { code: "authentication_failed", message: "expired", details: {} } }))
      .mockResolvedValueOnce(json(200, { access: "A2" }))
      .mockResolvedValueOnce(json(200, { id: "u" }));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.auth.me()).resolves.toEqual({ id: "u" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/auth/token/refresh");
    expect(f.mock.calls[2][1].headers.Authorization).toBe("Bearer A2");
  });

  it("parses the error envelope and field errors", async () => {
    const f = vi.fn().mockResolvedValue(json(400, { error: { code: "validation_error", message: "bad", details: { phone: ["Enter a valid number."] } } }));
    const api = createApiClient({ fetchImpl: f });
    const err = await api.auth.requestOtp("1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("validation_error");
    expect(err.field("phone")).toBe("Enter a valid number.");
  });

  it("maps fetch failures to network_error and keeps the session", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = createApiClient({ fetchImpl: f });
    const err = await api.catalog.categories().catch((e) => e);
    expect(err.isNetwork).toBe(true);
    expect(await api.restoreSession()).toBe(false);
  });

  it("de-duplicates concurrent refreshes", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { access: "A3" }));
    const api = createApiClient({ fetchImpl: f });
    await Promise.all([api.restoreSession(), api.restoreSession(), api.restoreSession()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("strips @ from vendor handle lookups", async () => {
    const f = vi.fn().mockResolvedValue(json(200, {}));
    const api = createApiClient({ fetchImpl: f });
    await api.vendors.byHandle("@sharma001");
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/sharma001");
  });
});
