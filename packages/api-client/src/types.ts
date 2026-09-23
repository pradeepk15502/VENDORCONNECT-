/* Shared API types. Keep in sync with docs/API.md (generated OpenAPI at /api/v1/schema/). */

export type Role = "customer" | "vendor" | "admin" | "moderator" | "support";

export interface Me {
  id: string;
  phone: string;
  name: string;
  email: string;
  language: "en" | "hi";
  roles: Role[];
  vendor: { handle: string; shop_name: string } | null;
  date_joined: string;
}

export interface OtpSent {
  sent: true;
  expires_in: number;
  resend_after: number;
  dev_otp?: string; // dev/test only
}

export interface LoginResult {
  access: string;
  is_new_user: boolean;
  user: Me;
}

export interface Category {
  slug: string;
  name: string;
  names_i18n: Record<string, string>;
  icon: string;
  parent: string | null;
  sort_order: number;
}

export interface DeliverySettings {
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  radius_km: string;
  min_order_amount: string;
  delivery_fee: string;
  free_delivery_above: string | null;
}

export interface VendorPublic {
  handle: string;
  vendor_id: string;
  shop_name: string;
  verified: boolean;
  is_open: boolean;
  status_changed_at: string | null;
  public_phone: string;
  categories: string[];
  rating_avg: string;
  rating_count: number;
  follower_count: number;
  location: { lat: number; lng: number; address_line: string; landmark: string; locality: string; city: string; pincode: string } | null;
  delivery: DeliverySettings;
  bio: string;
}

export interface VendorOwner extends VendorPublic {
  status: "active" | "suspended" | "closed_permanently";
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  onboarding_step: string;
  created_at: string;
}

export interface VendorCreateInput {
  shop_name: string;
  category_slugs: string[];
  location: { lat: number; lng: number; address_line: string; landmark?: string; locality?: string; city: string; state?: string; pincode?: string };
  public_phone?: string;
  bio?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}
