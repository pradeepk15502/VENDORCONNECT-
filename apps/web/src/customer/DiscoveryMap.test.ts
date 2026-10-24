import type { SearchResultItem, SearchVendor, VendorListItem } from "@vc/api-client";
import { describe, expect, it } from "vitest";
import { markersFromSearchResults, markersFromVendors } from "./DiscoveryMap";

function searchVendor(overrides: Partial<SearchVendor> = {}): SearchVendor {
  return {
    handle: "SHARMA001",
    vendor_id: "@SHARMA001",
    shop_name: "Sharma Vegetable Store",
    is_open: true,
    verified: false,
    delivery_enabled: false,
    lat: 28.4598,
    lng: 77.027,
    ...overrides,
  };
}

function searchResult(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    id: "l1",
    name: "Tomato",
    price: "30.00",
    mrp: null,
    unit: "kg",
    unit_quantity: "1.00",
    availability: "in_stock",
    category: "vegetables",
    product: { slug: "tomato", name: "Tomato" },
    freshness: "fresh",
    stock_updated_at: "2026-01-01T00:00:00Z",
    distance_km: 0.4,
    vendor: searchVendor(),
    ...overrides,
  };
}

function vendorListItem(overrides: Partial<VendorListItem> = {}): VendorListItem {
  return {
    handle: "SHARMA001",
    vendor_id: "@SHARMA001",
    shop_name: "Sharma Vegetable Store",
    verified: false,
    is_open: true,
    status_changed_at: null,
    public_phone: "+919000000101",
    categories: ["vegetables"],
    rating_avg: "0.00",
    rating_count: 0,
    follower_count: 0,
    location: { lat: 28.4598, lng: 77.027, address_line: "Shop", landmark: "", locality: "", city: "Gurugram", pincode: "" },
    delivery: { delivery_enabled: false, pickup_enabled: true, radius_km: "0", min_order_amount: "0", delivery_fee: "0", free_delivery_above: null },
    bio: "",
    distance_km: 0.4,
    ...overrides,
  };
}

describe("markersFromSearchResults", () => {
  it("maps a listing's vendor to one marker", () => {
    expect(markersFromSearchResults([searchResult()])).toEqual([
      { handle: "SHARMA001", name: "Sharma Vegetable Store", lat: 28.4598, lng: 77.027, isOpen: true, distanceKm: 0.4 },
    ]);
  });

  it("collapses several listings from the same shop into a single marker", () => {
    const rows = [
      searchResult({ id: "l1", name: "Tomato" }),
      searchResult({ id: "l2", name: "Onion" }),
    ];
    expect(markersFromSearchResults(rows)).toHaveLength(1);
  });

  it("skips a vendor with no location on file", () => {
    const rows = [searchResult({ vendor: searchVendor({ lat: null, lng: null }) })];
    expect(markersFromSearchResults(rows)).toEqual([]);
  });
});

describe("markersFromVendors", () => {
  it("maps a vendor card to one marker", () => {
    expect(markersFromVendors([vendorListItem()])).toEqual([
      { handle: "SHARMA001", name: "Sharma Vegetable Store", lat: 28.4598, lng: 77.027, isOpen: true, distanceKm: 0.4 },
    ]);
  });

  it("skips a vendor with no location on file", () => {
    expect(markersFromVendors([vendorListItem({ location: null })])).toEqual([]);
  });
});
