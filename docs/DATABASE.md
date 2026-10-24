# VendorConnect — Database

PostgreSQL 16 + PostGIS 3.4 + `pg_trgm` + `unaccent` (enabled by migration `core/0001_extensions`).
All business tables use **UUID primary keys**; the only sequential ids are on high-volume internal
tables (`chat_message`, `analytics_analyticsevent`, `audit_auditlog`) and those are never exposed
(`chat_message` exposes `public_id`). Vendors are addressed publicly by their handle.

Tables are named `<app>_<model>` (Django convention). Every mutable table has `created_at` / `updated_at`.

## Entity map (spec name → table)

| Spec entity | Table | Notes |
|---|---|---|
| users | `accounts_user` | phone (E.164) unique; `phone_verified_at`; `suspended_at` |
| roles | `accounts_role`, `accounts_userrole` | customer, vendor, admin, moderator, support (seeded) |
| — | `accounts_otpchallenge` | HMAC of code only; attempts, expiry, consumed |
| addresses | `accounts_address` | geography point; one default per user (partial unique) |
| — | `accounts_privacysettings` | share name with vendors, analytics opt-out |
| vendors | `vendors_vendor` | `handle` unique on `UPPER(handle)`; `is_open`, `status_changed_at`; denormalised rating/followers |
| vendor_profiles | `vendors_vendorprofile` | bio, images, GSTIN |
| vendor_locations | `vendors_vendorlocation` | `geography(Point,4326)` + GiST index |
| vendor_hours | `vendors_vendorhours` | informational; weekday check 0–6 |
| vendor_delivery_settings | `vendors_vendor_delivery_settings` | default delivery OFF; radius 0.5–50 km; at least one of pickup/delivery (CHECK) |
| — | `vendors_vendorverification` | verification decisions trail |
| categories | `catalog_category` | tree; Hindi names; per-category freshness thresholds |
| products | `catalog_product` | platform concept ("Tomato"); trigram index on name |
| — | `catalog_productvariety` | Hybrid / Desi … |
| — | `catalog_productalias` | multilingual synonyms, transliterations; trigram index on `normalized` |
| vendor_products | `catalog_vendorproduct` | vendor's listing: price, unit, availability, qty, `stock_updated_at`, `price_updated_at` |
| prices | `catalog_pricehistory` | append-only |
| inventory | `catalog_inventoryevent` | append-only; `client_mutation_id` unique per listing → idempotent offline sync |
| — | `catalog_marketprice` | reference ranges for advisory price suggestions (source + observed_at) |
| posts / post_media | `social_post`, `social_postmedia`, `social_postlike`, `social_postcomment` | |
| followers | `social_follow` | unique (user, vendor) |
| favorites | `social_favorite` | listing favourite + back-in-stock alert flag |
| reviews | `social_review`, `social_reviewmedia` | rating CHECK 1–5; vendor reply; moderation status |
| chats / messages | `chat_chat`, `chat_message`, `chat_quickreply` | one chat per (customer, vendor); idempotent `client_message_id` |
| carts / cart_items | `orders_cart`, `orders_cartitem` | items carry `vendor` for grouping |
| orders / order_items | `orders_order`, `orders_orderitem`, `orders_orderstatusevent` | one vendor per order; item snapshots |
| payments | `orders_payment` | |
| notifications | `notifications_notification`, `..._notificationpreference`, `..._pushsubscription` | |
| reports | `moderation_report` | also disputes |
| ai_detections | `ai_aidetection`, `ai_aimodelversion` | predictions JSON; `vendor_corrected` = training signal; `confirmed_listing` FK → `catalog_vendorproduct` once the vendor confirms (Phase 10 shipped against this unchanged Phase 0 schema — no migration was needed) |
| — | `assets_mediaasset` | object-storage keys, variants; no blobs in DB |
| — | `analytics_analyticsevent` | hashed actor, rounded coordinates |
| — | `audit_auditlog` | append-only admin/vendor actions |

Phase 11 (admin back-office) shipped against this schema almost entirely unchanged — `verification_status`/`verified_at` on
`vendors_vendor`, `VendorVerification`, and `is_active`/`suspended_at`/`suspension_reason` on `accounts_user` already existed
but were unwired until now. The one real migration it added is a new Django permission, `accounts.manage_users` (on `User.Meta`,
alongside the pre-existing `vendors.verify_vendor`/`vendors.suspend_vendor`) — no new table. See `docs/ARCHITECTURE.md` D32 for
the full audit behind this, including why Settings/category-CRUD were deliberately not given tables that don't exist yet.

## Key relationships

```
User 1─* UserRole *─1 Role
User 1─* Vendor (owner)                      Vendor 1─1 VendorProfile / VendorLocation / DeliverySettings
Vendor *─* Category                          Vendor 1─* VendorHours
Category 1─* Product 1─* ProductAlias        Product 1─* ProductVariety
Vendor 1─* VendorProduct *─0..1 Product      VendorProduct 1─* PriceHistory / InventoryEvent
User 1─1 Cart 1─* CartItem *─1 VendorProduct
Order *─1 Vendor, *─1 User; Order 1─* OrderItem / OrderStatusEvent / Payment
Vendor 1─* Post 1─* PostMedia;  User *─* Vendor via Follow;  Review *─1 Vendor, *─1 User, 0..1 Order
Chat (User, Vendor) 1─* Message
AIDetection *─1 Vendor, *─1 MediaAsset, 0..1─* VendorProduct (confirmed_listing)
```

## Business rules enforced in the database (not only in code)

- Vendor handle unique case-insensitively (`vendor_handle_ci_unique`).
- One active listing per (vendor, product, variety, unit) (`uniq_active_listing`, partial).
- Price ≥ 0; cart quantity > 0; rating 1–5; delivery radius range; pickup-or-delivery.
- One default address per user; one general review per (vendor, author); one review per completed
  order (`uniq_review_per_order`, Phase 9 — closes a race between two concurrent submits, not just
  a view-level pre-check).
- Inventory mutations idempotent (`uniq_inventory_mutation`); cart checkout idempotent per customer
  (`Order.idempotency_key`).
- One like per (post, user) (`uniq_post_like`); one follow per (user, vendor) (`uniq_follow`).

## Indexes that matter for the core loop

- `vendors_vendorlocation.point` GiST → `ST_DWithin` radius queries.
- Trigram GIN on `catalog_productalias.normalized`, `catalog_product.name`, `catalog_vendorproduct.name`, `vendors_vendor.shop_name` → typo-tolerant search.
- `(product, status, availability)` and `(vendor, status, availability)` on listings.

## Migrations & seed

```bash
cd services/api
python manage.py migrate          # schema + extensions + roles
python manage.py seed_taxonomy    # 12 categories, 52 products, ~240 Hindi/English aliases (idempotent)
python manage.py makemigrations --check --dry-run   # CI guard: models and migrations in sync
```

Taxonomy lives in `services/api/vc/catalog/data/taxonomy.json` (versioned; also the label set for the AI model).

## Backups

Production: managed PostgreSQL with point-in-time recovery (7–35 days) plus a nightly logical
`pg_dump` to object storage in another region, restore-tested monthly. See DEPLOYMENT.md.
