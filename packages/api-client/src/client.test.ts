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

  it("builds the search query string, dropping empty params, without auth", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.catalog.search({ q: "tomato", lat: 28.4595, lng: 77.0266, category: "", page: 2 });
    expect(f.mock.calls[0][0]).toBe("/api/v1/search?q=tomato&lat=28.4595&lng=77.0266&page=2");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("search() returns the paginated results as-is", async () => {
    const body = { count: 1, page: 1, page_size: 20, next: null, previous: null, results: [{ id: "l1", name: "Tomato" }] };
    const f = vi.fn().mockResolvedValue(json(200, body));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.catalog.search({ lat: 28.4595, lng: 77.0266 })).resolves.toEqual(body);
  });

  it("search() sends Phase 6 filter params, dropping false toggles", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.catalog.search({
      lat: 28.4595, lng: 77.0266,
      in_stock_only: true, open_now: true, delivery: false, pickup: false, price_min: 20, price_max: 60,
    });
    expect(f.mock.calls[0][0]).toBe(
      "/api/v1/search?lat=28.4595&lng=77.0266&in_stock_only=true&open_now=true&price_min=20&price_max=60",
    );
  });

  it("builds the vendors.near query string, dropping empty params, without auth", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.vendors.near({ lat: 28.4595, lng: 77.0266, category: "vegetables", radius_km: 10 });
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors?lat=28.4595&lng=77.0266&category=vegetables&radius_km=10");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("vendors.near() sends Phase 6 filter params, dropping false toggles", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.vendors.near({ lat: 28.4595, lng: 77.0266, open_now: true, delivery: true, pickup: false });
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors?lat=28.4595&lng=77.0266&open_now=true&delivery=true");
  });

  it("vendors.near() returns the paginated results as-is", async () => {
    const body = { count: 1, page: 1, page_size: 20, next: null, previous: null, results: [{ handle: "SHARMA001", distance_km: 0.4 }] };
    const f = vi.fn().mockResolvedValue(json(200, body));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.vendors.near({ lat: 28.4595, lng: 77.0266 })).resolves.toEqual(body);
  });

  it("vendorProducts.list() builds the query string and sends auth", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await api.vendorProducts.list({ category: "vegetables", availability: "low_stock" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendor-products?category=vegetables&availability=low_stock");
    expect(f.mock.calls[1][1].headers.Authorization).toBe("Bearer A1");
  });

  it("vendorProducts.create() POSTs the input and returns the created listing", async () => {
    const created = { id: "l1", name: "Tomato", price: "30" };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(201, created));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.vendorProducts.create({ category: "vegetables", name: "Tomato", price: "30", unit: "kg" })).resolves.toEqual(created);
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendor-products");
    expect(f.mock.calls[1][1].method).toBe("POST");
  });

  it("vendorProducts.remove() DELETEs by id", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(204, undefined));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await api.vendorProducts.remove("l1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendor-products/l1");
    expect(f.mock.calls[1][1].method).toBe("DELETE");
  });

  it("inventory.update() POSTs to /inventory", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { id: "l1", availability: "out_of_stock" }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.inventory.update({ listing_id: "l1", availability: "out_of_stock" })).resolves.toEqual({ id: "l1", availability: "out_of_stock" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/inventory");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ listing_id: "l1", availability: "out_of_stock" });
  });

  it("prices.update() POSTs to /prices", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { id: "l1", price: "25" }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.prices.update({ listing_id: "l1", price: "25" })).resolves.toEqual({ id: "l1", price: "25" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/prices");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ listing_id: "l1", price: "25" });
  });

  it("vendors.summary() GETs /vendors/me/summary with auth and returns it as-is", async () => {
    const body = { is_open: true, status_changed_at: "2026-01-01T00:00:00Z", product_count: 3, low_stock_count: 1, out_of_stock_count: 0 };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, body));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.vendors.summary()).resolves.toEqual(body);
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendors/me/summary");
    expect(f.mock.calls[1][1].headers.Authorization).toBe("Bearer A1");
  });

  /* --- Chat (Phase 7) ------------------------------------------------------------------- */

  it("chats.list() builds the ?role=&q= query string and returns the paginated results as-is", async () => {
    const body = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const f = vi.fn().mockResolvedValue(json(200, body));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.chats.list({ role: "customer", q: "sharma" })).resolves.toEqual(body);
    expect(f.mock.calls[0][0]).toBe("/api/v1/chats?role=customer&q=sharma");
  });

  it("chats.start() POSTs the vendor handle to /chats", async () => {
    const chat = { id: "c1", other: { handle: "SHARMA001" } };
    const f = vi.fn().mockResolvedValue(json(201, chat));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.chats.start("SHARMA001")).resolves.toEqual(chat);
    expect(f.mock.calls[0][0]).toBe("/api/v1/chats");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ vendor: "SHARMA001" });
  });

  it("chats.messages() sends `after` for polling and `before` for older history, never both keys unset", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { results: [], has_more: false }))
      .mockResolvedValueOnce(json(200, { results: [], has_more: false }))
      .mockResolvedValueOnce(json(200, { results: [], has_more: false }));
    const api = createApiClient({ fetchImpl: f });
    await api.chats.messages("c1", { after: 42 });
    expect(f.mock.calls[0][0]).toBe("/api/v1/chats/c1/messages?after=42");
    await api.chats.messages("c1", { before: 10 });
    expect(f.mock.calls[1][0]).toBe("/api/v1/chats/c1/messages?before=10");
    await api.chats.messages("c1");
    expect(f.mock.calls[2][0]).toBe("/api/v1/chats/c1/messages");
  });

  it("chats.send() POSTs the message and returns the created message", async () => {
    const msg = { id: "m1", cursor: 1, sender_side: "customer", kind: "text", text: "hi", listing: null, created_at: "2026-01-01T00:00:00Z" };
    const f = vi.fn().mockResolvedValue(json(201, msg));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.chats.send("c1", { kind: "text", text: "hi" })).resolves.toEqual(msg);
    expect(f.mock.calls[0][0]).toBe("/api/v1/chats/c1/messages");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ kind: "text", text: "hi" });
  });

  it("chats.block()/unblock()/read() POST to the right sub-paths with no body", async () => {
    const f = vi.fn().mockResolvedValue(json(204, undefined));
    const api = createApiClient({ fetchImpl: f });
    await api.chats.block("c1");
    expect(f.mock.calls[0][0]).toBe("/api/v1/chats/c1/block");
    await api.chats.unblock("c1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/chats/c1/unblock");
    await api.chats.markRead("c1");
    expect(f.mock.calls[2][0]).toBe("/api/v1/chats/c1/read");
    expect(f.mock.calls[2][1].method).toBe("POST");
  });

  it("chats.report() POSTs the reason and details", async () => {
    const f = vi.fn().mockResolvedValue(json(201, { status: "received" }));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.chats.report("c1", { reason: "spam" })).resolves.toEqual({ status: "received" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/chats/c1/report");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ reason: "spam" });
  });

  it("quickReplies.create()/list()/remove() hit the vendor quick-reply endpoints", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(201, { id: 1, text: "Yes, available", position: 1 }))
      .mockResolvedValueOnce(json(204, undefined));
    const api = createApiClient({ fetchImpl: f });
    await api.quickReplies.list();
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/me/quick-replies");
    await api.quickReplies.create("Yes, available");
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendors/me/quick-replies");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ text: "Yes, available" });
    await api.quickReplies.remove(3);
    expect(f.mock.calls[2][0]).toBe("/api/v1/vendors/me/quick-replies/3");
    expect(f.mock.calls[2][1].method).toBe("DELETE");
  });

  /* --- Phase 8: vendor products tab, addresses, cart, checkout, orders, notifications ------- */

  it("vendors.products() strips @ from the handle and sends no auth", async () => {
    const body = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const f = vi.fn().mockResolvedValue(json(200, body));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.vendors.products("@sharma001")).resolves.toEqual(body);
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/sharma001/products");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("vendors.updateDelivery() PATCHes /vendors/me/delivery", async () => {
    const settings = { delivery_enabled: true, pickup_enabled: true, radius_km: "5", min_order_amount: "0", delivery_fee: "20", free_delivery_above: null };
    const f = vi.fn().mockResolvedValue(json(200, settings));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.vendors.updateDelivery({ delivery_enabled: true })).resolves.toEqual(settings);
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/me/delivery");
    expect(f.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ delivery_enabled: true });
  });

  it("addresses.list()/create()/update()/remove() hit the address endpoints", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(201, { id: "a1", is_default: true }))
      .mockResolvedValueOnce(json(200, { id: "a1", is_default: true, label: "Office" }))
      .mockResolvedValueOnce(json(204, undefined));
    const api = createApiClient({ fetchImpl: f });
    await api.addresses.list();
    expect(f.mock.calls[0][0]).toBe("/api/v1/addresses");
    await api.addresses.create({ line1: "House 4", city: "Gurugram", pincode: "122001" });
    expect(f.mock.calls[1][1].method).toBe("POST");
    await api.addresses.update("a1", { label: "Office" });
    expect(f.mock.calls[2][0]).toBe("/api/v1/addresses/a1");
    expect(f.mock.calls[2][1].method).toBe("PATCH");
    await api.addresses.remove("a1");
    expect(f.mock.calls[3][1].method).toBe("DELETE");
  });

  it("cart.add() POSTs the listing and cart.update()/remove() target the item id", async () => {
    const item = { id: "ci1", listing_id: "l1", quantity: "2" };
    const f = vi.fn()
      .mockResolvedValueOnce(json(201, item))
      .mockResolvedValueOnce(json(200, { ...item, quantity: "3" }))
      .mockResolvedValueOnce(json(204, undefined));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.cart.add({ listing_id: "l1", quantity: 2 })).resolves.toEqual(item);
    expect(f.mock.calls[0][0]).toBe("/api/v1/cart");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ listing_id: "l1", quantity: 2 });
    await api.cart.update("ci1", { quantity: 3 });
    expect(f.mock.calls[1][0]).toBe("/api/v1/cart/items/ci1");
    expect(f.mock.calls[1][1].method).toBe("PATCH");
    await api.cart.remove("ci1");
    expect(f.mock.calls[2][0]).toBe("/api/v1/cart/items/ci1");
    expect(f.mock.calls[2][1].method).toBe("DELETE");
  });

  it("checkout.summary() builds the query string including address_id", async () => {
    const summary = { vendor: { handle: "SHARMA001" }, items: [], can_place_order: false };
    const f = vi.fn().mockResolvedValue(json(200, summary));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.checkout.summary({ vendor: "SHARMA001", fulfilment: "delivery", address_id: "addr1" })).resolves.toEqual(summary);
    expect(f.mock.calls[0][0]).toBe("/api/v1/checkout/summary?vendor=SHARMA001&fulfilment=delivery&address_id=addr1");
  });

  it("checkout.submit() POSTs the full checkout payload and returns the created order", async () => {
    const order = { id: "o1", number: "VC-ABC123", status: "placed" };
    const f = vi.fn().mockResolvedValue(json(201, order));
    const api = createApiClient({ fetchImpl: f });
    const input = {
      vendor: "SHARMA001", fulfilment: "pickup" as const, payment_method: "cash" as const,
      idempotency_key: "idem-0001", expected_items: [{ listing_id: "l1", price: "40", availability: "in_stock" as const }],
    };
    await expect(api.checkout.submit(input)).resolves.toEqual(order);
    expect(f.mock.calls[0][0]).toBe("/api/v1/checkout");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual(input);
  });

  it("checkout.submit() surfaces a 409 cart_changed error with its details", async () => {
    const f = vi.fn().mockResolvedValue(
      json(409, { error: { code: "cart_changed", message: "Some items changed.", details: { changes: [{ field: "price" }] } } }),
    );
    const api = createApiClient({ fetchImpl: f });
    const err = await api.checkout.submit({
      vendor: "SHARMA001", fulfilment: "pickup", payment_method: "cash",
      idempotency_key: "idem-0002", expected_items: [],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("cart_changed");
    expect(err.details.changes).toEqual([{ field: "price" }]);
  });

  it("orders.list() builds ?role=&status= and orders.get()/transition() target the order id", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }))
      .mockResolvedValueOnce(json(200, { id: "o1", status: "placed" }))
      .mockResolvedValueOnce(json(200, { id: "o1", status: "accepted" }));
    const api = createApiClient({ fetchImpl: f });
    await api.orders.list({ role: "vendor", status: "placed" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/orders?role=vendor&status=placed");
    await api.orders.get("o1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/orders/o1");
    await api.orders.transition("o1", { action: "accept" });
    expect(f.mock.calls[2][0]).toBe("/api/v1/orders/o1/transition");
    expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ action: "accept" });
  });

  it("notifications.list()/markRead()/markAllRead() hit the notification endpoints", async () => {
    const page = { count: 1, page: 1, page_size: 20, next: null, previous: null, results: [{ id: "n1" }], unread_count: 1 };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(204, undefined))
      .mockResolvedValueOnce(json(204, undefined));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.notifications.list()).resolves.toEqual(page);
    expect(f.mock.calls[0][0]).toBe("/api/v1/notifications");
    await api.notifications.markRead("n1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/notifications/n1/read");
    expect(f.mock.calls[1][1].method).toBe("POST");
    await api.notifications.markAllRead();
    expect(f.mock.calls[2][0]).toBe("/api/v1/notifications/read-all");
  });

  /* --- Phase 9: media, following, feed, posts, reviews, reports, moderation ------------------ */

  it("media.upload() sends a multipart FormData body with auth and no Content-Type header", async () => {
    const asset = { id: "m1", kind: "image", content_type: "image/jpeg", size_bytes: 10, width: 1, height: 1, url: "/m1", variant_urls: {} };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(201, asset));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await expect(api.media.upload(file)).resolves.toEqual(asset);
    expect(f.mock.calls[1][0]).toBe("/api/v1/media");
    const init = f.mock.calls[1][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers.Authorization).toBe("Bearer A1");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("media.upload() refreshes once on 401 and retries", async () => {
    const asset = { id: "m1", kind: "image" };
    const f = vi.fn()
      .mockResolvedValueOnce(json(401, { error: { code: "authentication_failed", message: "expired", details: {} } }))
      .mockResolvedValueOnce(json(200, { access: "A2" }))
      .mockResolvedValueOnce(json(201, asset));
    const api = createApiClient({ fetchImpl: f });
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await expect(api.media.upload(file)).resolves.toEqual(asset);
    expect(f.mock.calls[1][0]).toBe("/api/v1/auth/token/refresh");
    expect(f.mock.calls[2][1].headers.Authorization).toBe("Bearer A2");
  });

  it("vendors.byHandle() sends no auth header when signed out, and Bearer when signed in", async () => {
    const vendor = { handle: "SHARMA001", is_following: false };
    const f1 = vi.fn().mockResolvedValueOnce(json(200, vendor));
    const anon = createApiClient({ fetchImpl: f1 });
    await anon.vendors.byHandle("@sharma001");
    expect(f1.mock.calls[0][1].headers.Authorization).toBeUndefined();

    const f2 = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { ...vendor, is_following: true }));
    const signedIn = createApiClient({ fetchImpl: f2 });
    await signedIn.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(signedIn.vendors.byHandle("sharma001")).resolves.toEqual({ ...vendor, is_following: true });
    expect(f2.mock.calls[1][0]).toBe("/api/v1/vendors/sharma001");
    expect(f2.mock.calls[1][1].headers.Authorization).toBe("Bearer A1");
  });

  it("following.list() builds the query string and following.follow()/unfollow() POST to the right sub-paths", async () => {
    const page = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, { following: true, follower_count: 6 }))
      .mockResolvedValueOnce(json(200, { following: false, follower_count: 5 }));
    const api = createApiClient({ fetchImpl: f });
    await api.following.list({ lat: 28.4595, lng: 77.0266, page: 2 });
    expect(f.mock.calls[0][0]).toBe("/api/v1/following?lat=28.4595&lng=77.0266&page=2");
    await expect(api.following.follow("@sharma001")).resolves.toEqual({ following: true, follower_count: 6 });
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendors/sharma001/follow");
    expect(f.mock.calls[1][1].method).toBe("POST");
    await expect(api.following.unfollow("sharma001")).resolves.toEqual({ following: false, follower_count: 5 });
    expect(f.mock.calls[2][0]).toBe("/api/v1/vendors/sharma001/unfollow");
  });

  it("feed.list() GETs /feed with auth", async () => {
    const page = { count: 0, page: 1, page_size: 5, next: null, previous: null, results: [] };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, page));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.feed.list({ page_size: 5 })).resolves.toEqual(page);
    expect(f.mock.calls[1][0]).toBe("/api/v1/feed?page_size=5");
    expect(f.mock.calls[1][1].headers.Authorization).toBe("Bearer A1");
  });

  it("posts.mine.list()/create() hit /vendors/me/posts", async () => {
    const page = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const created = { id: "p1", kind: "update", media: [] };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(201, created));
    const api = createApiClient({ fetchImpl: f });
    await api.posts.mine.list({ page: 1 });
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/me/posts?page=1");
    const input = { kind: "update" as const, media_asset_ids: ["m1"] };
    await expect(api.posts.mine.create(input)).resolves.toEqual(created);
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendors/me/posts");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual(input);
  });

  it("posts.byVendor()/get() are public (no auth header)", async () => {
    const page = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const post = { id: "p1" };
    const f = vi.fn().mockResolvedValueOnce(json(200, page)).mockResolvedValueOnce(json(200, post));
    const api = createApiClient({ fetchImpl: f });
    await api.posts.byVendor("@sharma001");
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/sharma001/posts");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await expect(api.posts.get("p1")).resolves.toEqual(post);
    expect(f.mock.calls[1][0]).toBe("/api/v1/posts/p1");
    expect(f.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("posts.update()/remove()/report() target the post id", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { id: "p1", caption: "New caption" }))
      .mockResolvedValueOnce(json(204, undefined))
      .mockResolvedValueOnce(json(201, { status: "received" }));
    const api = createApiClient({ fetchImpl: f });
    await api.posts.update("p1", { caption: "New caption" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/posts/p1");
    expect(f.mock.calls[0][1].method).toBe("PATCH");
    await api.posts.remove("p1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/posts/p1");
    expect(f.mock.calls[1][1].method).toBe("DELETE");
    await expect(api.posts.report("p1", { reason: "spam" })).resolves.toEqual({ status: "received" });
    expect(f.mock.calls[2][0]).toBe("/api/v1/posts/p1/report");
  });

  it("reviews.byVendor()/byListing() are public, reviews.mine()/reply()/report() are authenticated", async () => {
    const page = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, { id: "r1", vendor_reply: "Thanks!" }))
      .mockResolvedValueOnce(json(201, { status: "received" }));
    const api = createApiClient({ fetchImpl: f });
    await api.reviews.byVendor("@sharma001");
    expect(f.mock.calls[0][0]).toBe("/api/v1/vendors/sharma001/reviews");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await api.reviews.byListing("l1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/listings/l1/reviews");
    expect(f.mock.calls[1][1].headers.Authorization).toBeUndefined();
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await api.reviews.mine({ page: 1 });
    expect(f.mock.calls[3][0]).toBe("/api/v1/reviews/mine?page=1");
    expect(f.mock.calls[3][1].headers.Authorization).toBe("Bearer A1");
    await expect(api.reviews.reply("r1", { vendor_reply: "Thanks!" })).resolves.toEqual({ id: "r1", vendor_reply: "Thanks!" });
    expect(f.mock.calls[4][0]).toBe("/api/v1/reviews/r1/reply");
    await expect(api.reviews.report("r1", { reason: "fake" })).resolves.toEqual({ status: "received" });
    expect(f.mock.calls[5][0]).toBe("/api/v1/reviews/r1/report");
  });

  it("orders.review() POSTs the rating to /orders/{id}/reviews", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(201, { id: "r1", rating: 5 }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.orders.review("o1", { rating: 5, text: "Great!" })).resolves.toEqual({ id: "r1", rating: 5 });
    expect(f.mock.calls[1][0]).toBe("/api/v1/orders/o1/reviews");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ rating: 5, text: "Great!" });
  });

  it("listings.detail() is a public GET", async () => {
    const item = { id: "l1", name: "Tomato" };
    const f = vi.fn().mockResolvedValueOnce(json(200, item));
    const api = createApiClient({ fetchImpl: f });
    await expect(api.listings.detail("l1")).resolves.toEqual(item);
    expect(f.mock.calls[0][0]).toBe("/api/v1/listings/l1");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("moderation.reports/posts/reviews hit the admin moderation endpoints with auth", async () => {
    const page = { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, { id: "rep1", status: "resolved" }))
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, { id: "p1", status: "hidden" }))
      .mockResolvedValueOnce(json(200, { id: "p1", status: "published" }))
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, { id: "r1", status: "hidden" }))
      .mockResolvedValueOnce(json(200, { id: "r1", status: "published" }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });

    await api.moderation.reports.list({ status: "open" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/moderation/reports?status=open");
    await api.moderation.reports.resolve("rep1", { status: "dismissed" });
    expect(f.mock.calls[2][0]).toBe("/api/v1/moderation/reports/rep1/resolve");
    expect(f.mock.calls[2][1].headers.Authorization).toBe("Bearer A1");

    await api.moderation.posts.list({ status: "published" });
    expect(f.mock.calls[3][0]).toBe("/api/v1/moderation/posts?status=published");
    await api.moderation.posts.hide("p1");
    expect(f.mock.calls[4][0]).toBe("/api/v1/moderation/posts/p1/hide");
    await api.moderation.posts.unhide("p1");
    expect(f.mock.calls[5][0]).toBe("/api/v1/moderation/posts/p1/unhide");

    await api.moderation.reviews.list({ vendor: "SHARMA001" });
    expect(f.mock.calls[6][0]).toBe("/api/v1/moderation/reviews?vendor=SHARMA001");
    await api.moderation.reviews.hide("r1");
    expect(f.mock.calls[7][0]).toBe("/api/v1/moderation/reviews/r1/hide");
    await api.moderation.reviews.unhide("r1");
    expect(f.mock.calls[8][0]).toBe("/api/v1/moderation/reviews/r1/unhide");
  });

  it("ai.detect() posts the image id and returns the detection", async () => {
    const detection = { id: "d1", status: "done", predictions: [{ label: "Tomato", confidence: 0.97, band: "likely" }] };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(201, detection));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(api.ai.detect("img1")).resolves.toEqual(detection);
    expect(f.mock.calls[1][0]).toBe("/api/v1/ai/detections");
    expect(f.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ image_id: "img1" });
  });

  it("ai.confirm() posts the vendor's final values and returns the created listing", async () => {
    const listing = { id: "l1", name: "Tomato", source: "ai" };
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(201, listing));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await expect(
      api.ai.confirm("d1", { category: "vegetables", product: "tomato", name: "Tomato", price: "28", unit: "kg" }),
    ).resolves.toEqual(listing);
    expect(f.mock.calls[1][0]).toBe("/api/v1/ai/detections/d1/confirm");
    expect(f.mock.calls[1][1].method).toBe("POST");
  });

  it("ai.history() builds the query string and sends auth", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await api.ai.history({ page: 2 });
    expect(f.mock.calls[1][0]).toBe("/api/v1/vendors/me/ai-detections?page=2");
    expect(f.mock.calls[1][1].headers.Authorization).toBe("Bearer A1");
  });

  it("admin.aiDetections.list() builds the filter query string and sends auth", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { access: "A1", is_new_user: false, user: { id: "u" } }))
      .mockResolvedValueOnce(json(200, { count: 0, page: 1, page_size: 50, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.auth.verifyOtp({ phone: "9876543210", code: "123456" });
    await api.admin.aiDetections.list({ status: "failed", vendor: "SHARMA001" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/admin/ai/detections?status=failed&vendor=SHARMA001");
    expect(f.mock.calls[1][1].headers.Authorization).toBe("Bearer A1");
  });

  /* --- Phase 11: admin back-office (ARCHITECTURE D32) --------------------------------------- */

  it("admin.dashboard() sends range/date params and drops the custom dates when range isn't custom", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(json(200, {})));
    const api = createApiClient({ fetchImpl: f });
    await api.admin.dashboard({ range: "30d" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/dashboard?range=30d");
    await api.admin.dashboard({ range: "custom", date_from: "2026-01-01", date_to: "2026-01-31" });
    expect(f.mock.calls[1][0]).toBe("/api/v1/admin/dashboard?range=custom&date_from=2026-01-01&date_to=2026-01-31");
  });

  it("admin.auditLogs.list() builds every filter into the query string", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { count: 0, page: 1, page_size: 30, next: null, previous: null, results: [] }));
    const api = createApiClient({ fetchImpl: f });
    await api.admin.auditLogs.list({ action: "vendor.verified", actor: "+919876543210", target_type: "vendor" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/audit-logs?action=vendor.verified&actor=%2B919876543210&target_type=vendor");
  });

  it("admin.users.list/get/suspend/restore hit the right URLs", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(json(200, { id: "u1" })));
    const api = createApiClient({ fetchImpl: f });
    await api.admin.users.list({ q: "Asha", role: "customer" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/users?q=Asha&role=customer");
    await api.admin.users.get("u1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/admin/users/u1");
    await api.admin.users.suspend("u1", { reason: "policy violation" });
    expect(f.mock.calls[2]).toEqual(["/api/v1/admin/users/u1/suspend", expect.objectContaining({ method: "POST" })]);
    expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ reason: "policy violation" });
    await api.admin.users.restore("u1");
    expect(f.mock.calls[3][0]).toBe("/api/v1/admin/users/u1/restore");
  });

  it("admin.vendors.* strips a leading @ from the handle on every route", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(json(200, { handle: "sharma001" })));
    const api = createApiClient({ fetchImpl: f });
    await api.admin.vendors.list({ q: "Sharma", verification_status: "pending" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/vendors?q=Sharma&verification_status=pending");
    await api.admin.vendors.get("@sharma001");
    expect(f.mock.calls[1][0]).toBe("/api/v1/admin/vendors/sharma001");
    await api.admin.vendors.verify("@sharma001", { decision: "verified", notes: "docs checked" });
    expect(f.mock.calls[2][0]).toBe("/api/v1/admin/vendors/sharma001/verify");
    await api.admin.vendors.suspend("@sharma001", { reason: "fraud report" });
    expect(f.mock.calls[3][0]).toBe("/api/v1/admin/vendors/sharma001/suspend");
    await api.admin.vendors.restore("@sharma001");
    expect(f.mock.calls[4][0]).toBe("/api/v1/admin/vendors/sharma001/restore");
  });

  it("admin.products.list() and admin.categories.list() build their routes", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(json(200, { count: 0, page: 1, page_size: 20, next: null, previous: null, results: [] })));
    const api = createApiClient({ fetchImpl: f });
    await api.admin.products.list({ q: "tomato", vendor: "sharma001", status: "deleted" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/products?q=tomato&vendor=sharma001&status=deleted");
    await api.admin.categories.list();
    expect(f.mock.calls[1][0]).toBe("/api/v1/admin/categories");
  });

  it("admin.orders.list()/get() build their routes, reusing OrderDetail's shape for detail", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(json(200, { id: "o1" })));
    const api = createApiClient({ fetchImpl: f });
    await api.admin.orders.list({ status: "placed", fulfilment: "pickup" });
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/orders?status=placed&fulfilment=pickup");
    await api.admin.orders.get("o1");
    expect(f.mock.calls[1][0]).toBe("/api/v1/admin/orders/o1");
  });
});
