import {
  ApiError,
  useSession,
  type AdminCategoryItem,
  type AdminDashboard,
  type AdminDashboardRange,
  type AdminListingItem,
  type AdminOrderListItem,
  type AdminPostItem,
  type AdminReportItem,
  type AdminReviewItem,
  type AdminUserDetail,
  type AdminUserListItem,
  type AdminVendorDetail,
  type AdminVendorListItem,
  type AIDetectionListItem,
  type AIDetectionStatus,
  type AuditLogItem,
  type ListingStatus,
  type OrderDetail,
  type OrderStatus,
  type ReportResolveInput,
  type ReportStatus,
  type ReportTargetType,
  type Role,
} from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage, LoginFlow } from "@vc/shell";
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Icon, Loading, Modal, Screen, StatusBadge, TextField, type IconName } from "@vc/ui";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";

const SECTIONS: { key: string; label: string; icon: IconName }[] = [
  { key: "dashboard", label: "Dashboard", icon: "home" },
  { key: "users", label: "Users", icon: "user" },
  { key: "vendors", label: "Vendors", icon: "store" },
  { key: "verification", label: "Vendor verification", icon: "shield" },
  { key: "products", label: "Products", icon: "box" },
  { key: "categories", label: "Categories", icon: "basket" },
  { key: "orders", label: "Orders", icon: "orders" },
  { key: "reviews", label: "Reviews", icon: "star" },
  { key: "posts", label: "Posts", icon: "share" },
  { key: "reports", label: "Reports", icon: "alert" },
  { key: "ai-scans", label: "AI Scans", icon: "box" },
  { key: "audit-logs", label: "Audit logs", icon: "clock" },
  { key: "settings", label: "Settings", icon: "globe" },
];

export type Who = { id: string; name: string; roles: string[]; permissions: string[] };

/** `who.permissions` is Django's `get_all_permissions()` (`"app_label.codename"` strings), or
 * `["*"]` for a superuser (see `AdminWhoAmIView`) — mirrors the backend's own
 * `user.is_superuser or user.has_perm(perm)` check (`admin_permission()`), so an action a caller
 * can't actually perform never appears here in the first place, rather than round-tripping a 403. */
export function hasPerm(who: Who, perm: string): boolean {
  return who.permissions.includes("*") || who.permissions.includes(perm);
}

/** Shared server-side pagination control (Phase 11) — every new admin list uses the same
 * `{count, page, page_size, results}` shape `StandardPagination` already established. */
export function Pagination({ page, pageSize, count, onChange }: { page: number; pageSize: number; count: number; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="a-pagination">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
      <span className="vc-muted">Page {page} of {totalPages} · {count} total</span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button>
    </div>
  );
}

/** Phase 12 hardening — admin list race guard (ARCHITECTURE.md D33). Every list section below
 * follows the same `const load = useCallback(...); useEffect(load, [load])` shape: `load` re-fires
 * on every filter/page change, often before the previous request has resolved (fast typing in a
 * search box, clicking through pages quickly). Without a guard, an older response's `.then()` can
 * land *after* a newer one and silently overwrite the screen with stale data — discovered in
 * Phase 11 for the Products list, and present in every other admin list here since they all share
 * the same shape. `startRequest()` hands back a `isCurrent()` check that only the most recent
 * caller passes, so a stale response's callback becomes a no-op instead of a state update. This is
 * deliberately not a full AbortController integration (the shared API client doesn't take a
 * signal) — a generation counter is the minimal fix for "stale responses can't overwrite newer
 * state" without changing `@vc/api-client`. */
export function useStaleGuard() {
  const seq = useRef(0);
  return useCallback(() => {
    const mine = ++seq.current;
    return () => mine === seq.current;
  }, []);
}

/** Phase 12 hardening — keyboard/screen-reader access for clickable table rows (a11y). A bare
 * `<tr onClick>` (Users/Vendors/Orders lists) has no focus stop and no announced role, so a
 * keyboard-only or screen-reader admin can't open it at all. Rows stay `<tr>` (table semantics and
 * columns are unchanged) but become a real, activatable control: focusable, announced as a button,
 * and openable with Enter or Space, not just a pointer click. */
export function rowActivation(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

const REPORT_STATUSES: ReportStatus[] = ["open", "reviewing", "resolved", "dismissed"];
const REPORT_TARGET_TYPES: ReportTargetType[] = ["vendor", "listing", "post", "review", "message", "user", "order"];

function ResolveReportModal({ report, onClose, onResolved }: { report: AdminReportItem | null; onClose: () => void; onResolved: (r: AdminReportItem) => void }) {
  const { api } = useSession();
  const [status, setStatus] = useState<"resolved" | "dismissed">("resolved");
  const [resolution, setResolution] = useState("");
  const [hideTarget, setHideTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    setStatus("resolved");
    setResolution("");
    setHideTarget(false);
    setErr(undefined);
  }, [report?.id]);

  if (!report) return null;
  const canHide = report.target_type === "post" || report.target_type === "review";

  async function submit() {
    setBusy(true);
    setErr(undefined);
    try {
      const input: ReportResolveInput = { status, resolution: resolution.trim() || undefined, hide_target: canHide ? hideTarget : undefined };
      const updated = await api.moderation.reports.resolve(report!.id, input);
      onResolved(updated);
    } catch (e) {
      setErr(errorMessage(e, (k) => k));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Resolve report — ${report.target_type} (${report.reason})`} closeLabel="Close">
      <div className="vc-stack">
        {report.details ? <p className="vc-muted">Reporter's details: {report.details}</p> : null}
        <div className="vc-row" role="group" aria-label="Outcome">
          <label className="vc-row" style={{ gap: 6 }}>
            <input type="radio" name="resolve-status" checked={status === "resolved"} onChange={() => setStatus("resolved")} /> Resolved
          </label>
          <label className="vc-row" style={{ gap: 6 }}>
            <input type="radio" name="resolve-status" checked={status === "dismissed"} onChange={() => setStatus("dismissed")} /> Dismissed
          </label>
        </div>
        {canHide ? (
          <label className="vc-row" style={{ gap: 6 }}>
            <input type="checkbox" checked={hideTarget} onChange={(e) => setHideTarget(e.target.checked)} /> Hide this {report.target_type} (audit-preserving — never deleted)
          </label>
        ) : null}
        <TextField label="Resolution note (optional)" value={resolution} onChange={(e) => setResolution(e.target.value)} name="resolution" />
        {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
        <div className="vc-row">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={submit}>Submit</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Admin "Reports" (master prompt §26/§27) — every report a customer or vendor filed, real
 * `POST /moderation/reports/{id}/resolve`, and hiding a target never deletes it (audit trail). */
function ReportsSection({ who }: { who: Who }) {
  const { api } = useSession();
  const [items, setItems] = useState<AdminReportItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [status, setStatus] = useState<ReportStatus | "">("open");
  const [targetType, setTargetType] = useState<ReportTargetType | "">("");
  const [resolving, setResolving] = useState<AdminReportItem | null>(null);
  const canHandle = hasPerm(who, "moderation.handle_report");

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.moderation.reports
      .list({ status: status || undefined, target_type: targetType || undefined, page_size: 50 })
      .then((r) => { if (isCurrent()) setItems(r.results); })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, status, targetType, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Reports</h1>
      <div className="vc-row">
        <select value={status} onChange={(e) => setStatus(e.target.value as ReportStatus | "")} aria-label="Filter by status">
          <option value="">All statuses</option>
          {REPORT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as ReportTargetType | "")} aria-label="Filter by target type">
          <option value="">All types</option>
          {REPORT_TARGET_TYPES.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
        </select>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="alert" title="No reports" message="Nothing matches this filter." />
      ) : (
        <table className="a-table">
          <thead><tr><th>Type</th><th>Reason</th><th>Reporter</th><th>Status</th><th>Reported</th><th /></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.target_type}</td>
                <td>{r.reason}</td>
                <td>{r.reporter_name}</td>
                <td>
                  <StatusBadge kind={r.status === "open" || r.status === "reviewing" ? "low_stock" : r.status === "resolved" ? "in_stock" : "closed"} size="sm" label={r.status} />
                </td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  {canHandle && (r.status === "open" || r.status === "reviewing") ? (
                    <Button variant="secondary" onClick={() => setResolving(r)}>Resolve</Button>
                  ) : r.handled_by_name ? (
                    <span className="vc-muted">by {r.handled_by_name}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ResolveReportModal
        report={resolving}
        onClose={() => setResolving(null)}
        onResolved={(updated) => {
          setItems((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
          setResolving(null);
        }}
      />
    </Card>
  );
}

/** Admin "Posts" moderation (master prompt §26) — hide/unhide a post directly (not only via a
 * filed report), audit-preserving (never deletes the row). */
function PostsModerationSection({ who }: { who: Who }) {
  const { api } = useSession();
  const [items, setItems] = useState<AdminPostItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [vendor, setVendor] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const canModerate = hasPerm(who, "social.moderate_post");

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.moderation.posts
      .list({ status: status || undefined, vendor: vendor.trim() || undefined, page_size: 50 })
      .then((r) => { if (isCurrent()) setItems(r.results); })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, status, vendor, guard]);
  useEffect(load, [load]);

  async function toggle(item: AdminPostItem) {
    setBusyId(item.id);
    try {
      const updated = item.status === "hidden" ? await api.moderation.posts.unhide(item.id) : await api.moderation.posts.hide(item.id);
      setItems((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
    } catch {
      /* left as-is; the row's own status still reflects the last known server state */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Posts</h1>
      <div className="vc-row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden</option>
          <option value="removed">Removed</option>
        </select>
        <TextField label="Vendor handle" value={vendor} onChange={(e) => setVendor(e.target.value)} name="vendor" placeholder="e.g. SHARMA001" />
        <Button variant="secondary" onClick={load}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="share" title="No posts" message="Nothing matches this filter." />
      ) : (
        <table className="a-table">
          <thead><tr><th>Shop</th><th>Kind</th><th>Caption</th><th>Status</th><th>Posted</th><th /></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.shop_name} <span className="vc-muted">@{p.vendor_handle}</span></td>
                <td>{p.kind}</td>
                <td>{p.caption}</td>
                <td><StatusBadge kind={p.status === "published" ? "open" : "closed"} size="sm" label={p.status} /></td>
                <td>{new Date(p.created_at).toLocaleString()}</td>
                <td>
                  {canModerate ? (
                    <Button variant={p.status === "hidden" ? "secondary" : "danger"} loading={busyId === p.id} onClick={() => toggle(p)}>
                      {p.status === "hidden" ? "Unhide" : "Hide"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Admin "Reviews" moderation (master prompt §26) — hiding a review recomputes the vendor's rating
 * server-side; this UI just triggers the same real hide/unhide endpoints a filed report resolves. */
function ReviewsModerationSection({ who }: { who: Who }) {
  const { api } = useSession();
  const [items, setItems] = useState<AdminReviewItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [vendor, setVendor] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const canModerate = hasPerm(who, "social.moderate_review");

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.moderation.reviews
      .list({ status: status || undefined, vendor: vendor.trim() || undefined, page_size: 50 })
      .then((r) => { if (isCurrent()) setItems(r.results); })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, status, vendor, guard]);
  useEffect(load, [load]);

  async function toggle(item: AdminReviewItem) {
    setBusyId(item.id);
    try {
      const updated = item.status === "hidden" ? await api.moderation.reviews.unhide(item.id) : await api.moderation.reviews.hide(item.id);
      setItems((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
    } catch {
      /* left as-is; the row's own status still reflects the last known server state */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Reviews</h1>
      <div className="vc-row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden</option>
          <option value="flagged">Flagged</option>
        </select>
        <TextField label="Vendor handle" value={vendor} onChange={(e) => setVendor(e.target.value)} name="vendor" placeholder="e.g. SHARMA001" />
        <Button variant="secondary" onClick={load}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="star" title="No reviews" message="Nothing matches this filter." />
      ) : (
        <table className="a-table">
          <thead><tr><th>Vendor</th><th>Rating</th><th>Author</th><th>Text</th><th>Status</th><th /></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>@{r.vendor_handle}</td>
                <td>{r.rating} ★</td>
                <td>{r.author_name}</td>
                <td>{r.text}</td>
                <td><StatusBadge kind={r.status === "published" ? "open" : "closed"} size="sm" label={r.status} /></td>
                <td>
                  {canModerate ? (
                    <Button variant={r.status === "hidden" ? "secondary" : "danger"} loading={busyId === r.id} onClick={() => toggle(r)}>
                      {r.status === "hidden" ? "Unhide" : "Hide"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ================================================================================================
 * Phase 11 — admin back-office (ARCHITECTURE D32): Dashboard, Users, Vendors (+ verification),
 * Products, Categories, Orders, Audit logs. Every list below is server-side searched/filtered/
 * paginated; every mutating action re-fetches from the server afterwards rather than guessing the
 * new state client-side (server-authoritative, matching the moderation sections above).
 * ============================================================================================= */

const DASHBOARD_RANGES: { key: AdminDashboardRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="a-stat">
      <span className="a-stat__value">{value}</span>
      <span className="a-stat__label">{label}</span>
    </div>
  );
}

/** Admin "Dashboard" (master prompt §4/§5) — every number is a live DB aggregate for the selected
 * period, fetched fresh on every range change; an empty platform genuinely shows zeroes here, never
 * a placeholder. Analytics was folded into this one screen rather than built as a second section
 * (master prompt's "DO NOT OVERBUILD": no separate BI surface). */
function DashboardSection() {
  const { api } = useSession();
  const [range, setRange] = useState<AdminDashboardRange>("7d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const guard = useStaleGuard();
  const load = useCallback(() => {
    if (range === "custom" && (!dateFrom || !dateTo)) return;
    setErr(null);
    const isCurrent = guard();
    api.admin
      .dashboard({ range, date_from: range === "custom" ? dateFrom : undefined, date_to: range === "custom" ? dateTo : undefined })
      .then((r) => { if (isCurrent()) setData(r); })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, range, dateFrom, dateTo, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Dashboard</h1>
      <div className="vc-row" role="group" aria-label="Time range">
        {DASHBOARD_RANGES.map((r) => (
          <Chip key={r.key} selected={range === r.key} onClick={() => setRange(r.key)}>{r.label}</Chip>
        ))}
        {range === "custom" ? (
          <>
            <TextField label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} name="date_from" />
            <TextField label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} name="date_to" />
          </>
        ) : null}
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : data === null ? (
        range === "custom" && (!dateFrom || !dateTo) ? (
          <p className="vc-muted">Choose both a start and end date.</p>
        ) : (
          <Loading label="Loading…" />
        )
      ) : (
        <>
          <p className="vc-muted">
            {new Date(data.period_start).toLocaleString()} – {new Date(data.period_end).toLocaleString()}
          </p>
          <div className="a-stat-group">
            <span className="a-stat-group__title">Users</span>
            <div className="a-stats">
              <StatCard value={data.users.total} label="Total accounts (all time)" />
              <StatCard value={data.users.new} label="New this period" />
              <StatCard value={data.users.active} label="Active this period" />
            </div>
          </div>
          <div className="a-stat-group">
            <span className="a-stat-group__title">Vendors</span>
            <div className="a-stats">
              <StatCard value={data.vendors.total} label="Total shops (all time)" />
              <StatCard value={data.vendors.pending_verification} label="Pending verification" />
              <StatCard value={data.vendors.active} label="Active" />
              <StatCard value={data.vendors.suspended} label="Suspended" />
            </div>
          </div>
          <div className="a-stat-group">
            <span className="a-stat-group__title">Catalog</span>
            <div className="a-stats">
              <StatCard value={data.products.total} label="Taxonomy products (all time)" />
              <StatCard value={data.products.active_listings} label="Active listings" />
              <StatCard value={data.products.out_of_stock_listings} label="Out of stock listings" />
            </div>
          </div>
          <div className="a-stat-group">
            <span className="a-stat-group__title">Orders this period</span>
            <div className="a-stats">
              <StatCard value={data.orders.total} label="Placed" />
              <StatCard value={data.orders.pending} label="In flight" />
              <StatCard value={data.orders.completed} label="Completed" />
              <StatCard value={data.orders.cancelled} label="Cancelled / rejected" />
            </div>
          </div>
          <div className="a-stat-group">
            <span className="a-stat-group__title">Moderation</span>
            <div className="a-stats">
              <StatCard value={data.moderation.open_reports} label="Open reports (backlog)" />
              <StatCard value={data.moderation.reported_posts} label="Posts reported this period" />
              <StatCard value={data.moderation.reported_reviews} label="Reviews reported this period" />
              <StatCard value={data.moderation.hidden_content} label="Currently hidden content" />
            </div>
          </div>
          <div className="a-stat-group">
            <span className="a-stat-group__title">AI scans this period</span>
            <div className="a-stats">
              <StatCard value={data.ai.detections} label="Scans attempted" />
              <StatCard value={data.ai.failed_detections} label="Failed" />
              <StatCard value={data.ai.dev_scanner_usage} label="From development scanner" />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

const ROLES: Role[] = ["customer", "vendor", "admin", "moderator", "support"];

/** A user's full detail, with suspend/restore gated behind `accounts.manage_users` — matches the
 * exact permission the backend re-checks server-side, so a caller without it never even sees the
 * button rather than clicking it and getting a 403. */
function UserDetailModal({ userId, onClose, canManage, onChanged }: { userId: string | null; onClose: () => void; canManage: boolean; onChanged: () => void }) {
  const { api } = useSession();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setDetail(null);
    setErr(null);
    setReason("");
    api.admin.users.get(userId).then(setDetail).catch(setErr);
  }, [api, userId]);

  if (!userId) return null;

  async function suspend() {
    setBusy(true);
    try {
      const updated = await api.admin.users.suspend(userId!, { reason });
      setDetail(updated);
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      const updated = await api.admin.users.restore(userId!);
      setDetail(updated);
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="User detail" closeLabel="Close">
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} />
      ) : detail === null ? (
        <Loading label="Loading…" />
      ) : (
        <div className="vc-stack">
          <p><b>{detail.name || "Unnamed"}</b> · {detail.phone}</p>
          {detail.email ? <p className="vc-muted">{detail.email}</p> : null}
          <p>Roles: {detail.roles.join(", ") || "—"}</p>
          <StatusBadge kind={detail.is_active ? "open" : "closed"} size="sm" label={detail.is_active ? "Active" : "Suspended"} />
          {detail.vendor ? <p>Vendor: {detail.vendor.shop_name} (@{detail.vendor.handle})</p> : null}
          <p className="vc-muted">
            Joined {new Date(detail.date_joined).toLocaleString()} · Last login{" "}
            {detail.last_login ? new Date(detail.last_login).toLocaleString() : "never"}
          </p>
          <p className="vc-muted">
            {detail.order_count} orders · {detail.reports_filed_count} reports filed · {detail.reports_against_count} reports against
          </p>
          {!detail.is_active && detail.suspension_reason ? (
            <Banner tone="warn" icon="alert">Suspended: {detail.suspension_reason}</Banner>
          ) : null}
          {canManage ? (
            detail.is_active ? (
              <div className="vc-stack">
                <TextField label="Suspension reason" value={reason} onChange={(e) => setReason(e.target.value)} name="reason" />
                <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={suspend}>Suspend account</Button>
              </div>
            ) : (
              <Button loading={busy} onClick={restore}>Restore account</Button>
            )
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/** Admin "Users" (master prompt §6/§7) — every account on the platform, searchable by name/phone,
 * filterable by role/active state. Suspend/restore require `accounts.manage_users` server-side. */
function UsersSection({ who }: { who: Who }) {
  const { api } = useSession();
  const [items, setItems] = useState<AdminUserListItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [isActive, setIsActive] = useState<"" | "true" | "false">("");
  const [selected, setSelected] = useState<string | null>(null);
  const canManage = hasPerm(who, "accounts.manage_users");
  const pageSize = 20;

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.users
      .list({ q: q.trim() || undefined, role: role || undefined, is_active: isActive === "" ? undefined : isActive === "true", page, page_size: pageSize })
      .then((r) => {
        if (!isCurrent()) return;
        setItems(r.results);
        setCount(r.count);
      })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, q, role, isActive, page, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Users</h1>
      <div className="vc-row">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} name="q" placeholder="Name or phone" />
        <select value={role} onChange={(e) => { setRole(e.target.value as Role | ""); setPage(1); }} aria-label="Filter by role">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={isActive} onChange={(e) => { setIsActive(e.target.value as typeof isActive); setPage(1); }} aria-label="Filter by status">
          <option value="">Active + suspended</option>
          <option value="true">Active only</option>
          <option value="false">Suspended only</option>
        </select>
        <Button variant="secondary" onClick={() => setPage(1)}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="user" title="No users" message="Nothing matches this filter." />
      ) : (
        <>
          <table className="a-table">
            <thead><tr><th>Name</th><th>Phone</th><th>Roles</th><th>Vendor</th><th>Status</th><th>Joined</th></tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="is-clickable" {...rowActivation(() => setSelected(u.id))}>
                  <td>{u.name || "Unnamed"}</td>
                  <td>{u.phone}</td>
                  <td>{u.roles.join(", ")}</td>
                  <td>{u.vendor ? `@${u.vendor.handle}` : "—"}</td>
                  <td><StatusBadge kind={u.is_active ? "open" : "closed"} size="sm" label={u.is_active ? "Active" : "Suspended"} /></td>
                  <td>{new Date(u.date_joined).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} />
        </>
      )}
      <UserDetailModal userId={selected} onClose={() => setSelected(null)} canManage={canManage} onChanged={load} />
    </Card>
  );
}

const VENDOR_STATUSES = ["active", "suspended", "closed_permanently"] as const;
const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"] as const;

function VendorDetailModal({
  handle,
  onClose,
  canVerify,
  canSuspend,
  onChanged,
}: {
  handle: string | null;
  onClose: () => void;
  canVerify: boolean;
  canSuspend: boolean;
  onChanged: () => void;
}) {
  const { api } = useSession();
  const [detail, setDetail] = useState<AdminVendorDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!handle) return;
    setDetail(null);
    setErr(null);
    setNotes("");
    setReason("");
    api.admin.vendors.get(handle).then(setDetail).catch(setErr);
  }, [api, handle]);

  if (!handle) return null;

  async function act(fn: () => Promise<AdminVendorDetail>) {
    setBusy(true);
    try {
      const updated = await fn();
      setDetail(updated);
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Vendor detail" closeLabel="Close">
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} />
      ) : detail === null ? (
        <Loading label="Loading…" />
      ) : (
        <div className="vc-stack">
          <p><b>{detail.shop_name}</b> · @{detail.handle}</p>
          <p className="vc-muted">Owner: {detail.owner.name || "Unnamed"} · {detail.owner.phone}</p>
          <div className="vc-row">
            <StatusBadge kind={detail.status === "active" ? "open" : "closed"} size="sm" label={detail.status} />
            <StatusBadge kind={detail.verification_status === "verified" ? "verified" : "unverified"} size="sm" label={detail.verification_status} />
          </div>
          <p className="vc-muted">{detail.city || "No city on file"} · {detail.categories.join(", ") || "No categories"}</p>
          <p className="vc-muted">
            {detail.product_count} listings · {detail.order_count} orders · {detail.review_count} reviews · {detail.post_count} posts ·{" "}
            {detail.rating_avg}★ ({detail.rating_count})
          </p>
          {canVerify && detail.verification_status !== "verified" ? (
            <div className="vc-stack">
              <TextField label="Verification notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} name="notes" />
              <div className="vc-row">
                <Button loading={busy} onClick={() => act(() => api.admin.vendors.verify(handle, { decision: "verified", notes }))}>Verify</Button>
                <Button variant="danger" loading={busy} onClick={() => act(() => api.admin.vendors.verify(handle, { decision: "rejected", notes }))}>Reject</Button>
              </div>
            </div>
          ) : null}
          {canSuspend ? (
            detail.status !== "suspended" ? (
              <div className="vc-stack">
                <TextField label="Suspension reason" value={reason} onChange={(e) => setReason(e.target.value)} name="reason" />
                <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => act(() => api.admin.vendors.suspend(handle, { reason }))}>
                  Suspend shop
                </Button>
              </div>
            ) : (
              <Button loading={busy} onClick={() => act(() => api.admin.vendors.restore(handle))}>Restore shop</Button>
            )
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/** Admin "Vendors" (master prompt §8) and "Vendor verification" (§9) share this one component —
 * the same list/detail shape, just a different default filter and title. Unlike the public
 * `/vendors` list, this always includes suspended shops (that visibility gap is the point). */
function VendorsSection({ who, verificationOnly = false }: { who: Who; verificationOnly?: boolean }) {
  const { api } = useSession();
  const [items, setItems] = useState<AdminVendorListItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [verificationStatus, setVerificationStatus] = useState(verificationOnly ? "pending" : "");
  const [selected, setSelected] = useState<string | null>(null);
  const canVerify = hasPerm(who, "vendors.verify_vendor");
  const canSuspend = hasPerm(who, "vendors.suspend_vendor");
  const pageSize = 20;

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.vendors
      .list({ q: q.trim() || undefined, status: status || undefined, verification_status: verificationStatus || undefined, page, page_size: pageSize })
      .then((r) => {
        if (!isCurrent()) return;
        setItems(r.results);
        setCount(r.count);
      })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, q, status, verificationStatus, page, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">{verificationOnly ? "Vendor verification" : "Vendors"}</h1>
      <div className="vc-row">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} name="q" placeholder="Shop name or handle" />
        {!verificationOnly ? (
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : null}
        <select
          value={verificationStatus}
          onChange={(e) => { setVerificationStatus(e.target.value); setPage(1); }}
          aria-label="Filter by verification status"
        >
          {verificationOnly ? null : <option value="">Any verification status</option>}
          {VERIFICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="secondary" onClick={() => setPage(1)}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="store"
          title={verificationOnly ? "Nothing pending" : "No vendors"}
          message={verificationOnly ? "No vendor is currently waiting on a verification decision." : "Nothing matches this filter."}
        />
      ) : (
        <>
          <table className="a-table">
            <thead><tr><th>Shop</th><th>Owner</th><th>Status</th><th>Verification</th><th>City</th><th>Categories</th></tr></thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.handle} className="is-clickable" {...rowActivation(() => setSelected(v.handle))}>
                  <td>{v.shop_name} <span className="vc-muted">@{v.handle}</span></td>
                  <td>{v.owner.name || "Unnamed"} <span className="vc-muted">{v.owner.phone}</span></td>
                  <td><StatusBadge kind={v.status === "active" ? "open" : "closed"} size="sm" label={v.status} /></td>
                  <td><StatusBadge kind={v.verification_status === "verified" ? "verified" : "unverified"} size="sm" label={v.verification_status} /></td>
                  <td>{v.city || "—"}</td>
                  <td>{v.categories.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} />
        </>
      )}
      <VendorDetailModal handle={selected} onClose={() => setSelected(null)} canVerify={canVerify} canSuspend={canSuspend} onChanged={load} />
    </Card>
  );
}

const LISTING_STATUSES: ListingStatus[] = ["active", "paused", "deleted"];

/** Admin "Products" (master prompt §10) — every vendor's listing across the platform, read-only.
 * There is no admin path that writes a vendor's own price/stock; staff spot duplicates or
 * suspicious entries themselves by browsing and filtering. */
function ProductsSection() {
  const { api } = useSession();
  const [items, setItems] = useState<AdminListingItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [status, setStatus] = useState("");
  const pageSize = 20;

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.products
      .list({ q: q.trim() || undefined, category: category.trim() || undefined, vendor: vendor.trim() || undefined, status: status || undefined, page, page_size: pageSize })
      .then((r) => {
        if (!isCurrent()) return;
        setItems(r.results);
        setCount(r.count);
      })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, q, category, vendor, status, page, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Products</h1>
      <p className="vc-muted">
        Every vendor's listing across the platform, read-only — a vendor's own price and stock can only ever be changed from their own shop screens.
      </p>
      <div className="vc-row">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} name="q" placeholder="Listing name" />
        <TextField label="Vendor handle" value={vendor} onChange={(e) => setVendor(e.target.value)} name="vendor" placeholder="e.g. SHARMA001" />
        <TextField label="Category slug" value={category} onChange={(e) => setCategory(e.target.value)} name="category" placeholder="e.g. vegetables" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">Active + paused</option>
          {LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="secondary" onClick={() => setPage(1)}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="box" title="No listings" message="Nothing matches this filter." />
      ) : (
        <>
          <table className="a-table">
            <thead><tr><th>Listing</th><th>Vendor</th><th>Category</th><th>Price</th><th>Availability</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.vendor.shop_name} <span className="vc-muted">@{p.vendor.handle}</span></td>
                  <td>{p.category}</td>
                  <td>₹{p.price}/{p.unit}</td>
                  <td>
                    <StatusBadge
                      kind={p.availability === "in_stock" ? "in_stock" : p.availability === "low_stock" ? "low_stock" : "out_of_stock"}
                      size="sm"
                      label={p.availability}
                    />
                  </td>
                  <td><StatusBadge kind={p.status === "active" ? "open" : "closed"} size="sm" label={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

/** Admin "Categories" (master prompt §10) — unlike the public list, includes inactive entries and
 * real usage counts so staff can spot an unused or duplicated taxonomy entry. Read-only: category
 * CRUD (merge/rename) is deferred (see docs/ARCHITECTURE.md D32). Not paginated, matching the
 * backend's own choice for this small, fixed taxonomy. */
function CategoriesSection() {
  const { api } = useSession();
  const [items, setItems] = useState<AdminCategoryItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.categories.list().then((r) => { if (isCurrent()) setItems(r); }).catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Categories</h1>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="basket" title="No categories" />
      ) : (
        <table className="a-table">
          <thead><tr><th>Category</th><th>Active?</th><th>Products</th><th>Listings</th><th>Vendors</th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.slug}>
                <td>{c.name} <span className="vc-muted">{c.slug}</span></td>
                <td><StatusBadge kind={c.is_active ? "open" : "closed"} size="sm" label={c.is_active ? "Active" : "Inactive"} /></td>
                <td>{c.product_count}</td>
                <td>{c.listing_count}</td>
                <td>{c.vendor_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const ORDER_STATUSES: OrderStatus[] = [
  "placed", "accepted", "rejected", "preparing", "ready", "out_for_delivery", "delivered", "picked_up", "completed", "cancelled",
];

export function orderStatusKind(status: OrderStatus): "in_stock" | "out_of_stock" | "low_stock" {
  if (status === "completed" || status === "delivered" || status === "picked_up") return "in_stock";
  if (status === "cancelled" || status === "rejected") return "out_of_stock";
  return "low_stock";
}

/** Read-only order detail for support visibility — reuses the exact same `OrderDetail` shape the
 * customer/vendor sides already see (including its existing omission of the customer's phone
 * number), rather than a second, parallel order-detail shape. */
function AdminOrderDetailModal({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { api } = useSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (!orderId) return;
    setOrder(null);
    setErr(null);
    api.admin.orders.get(orderId).then(setOrder).catch(setErr);
  }, [api, orderId]);

  if (!orderId) return null;

  return (
    <Modal open onClose={onClose} title="Order detail" closeLabel="Close">
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} />
      ) : order === null ? (
        <Loading label="Loading…" />
      ) : (
        <div className="vc-stack">
          <div className="vc-row">
            <b>{order.number}</b>
            <StatusBadge kind={orderStatusKind(order.status)} size="sm" label={order.status} />
          </div>
          <p className="vc-muted">
            {order.customer.name || "Customer"} → {order.vendor.shop_name} (@{order.vendor.handle}) · {order.fulfilment}
          </p>
          <ul className="vc-stack">
            {order.items.map((it, i) => (
              <li key={i}>{it.quantity} × {it.name} — ₹{it.line_total}</li>
            ))}
          </ul>
          <p>Subtotal ₹{order.subtotal} + delivery ₹{order.delivery_fee} = <b>₹{order.total}</b></p>
          <p className="vc-muted">Payment: {order.payment_method} · {order.payment_status ?? "—"}</p>
          {order.rejection_reason ? <p className="vc-muted">Rejection reason: {order.rejection_reason}</p> : null}
          <div className="vc-stack">
            <b>Timeline</b>
            {order.events.map((e, i) => (
              <p key={i} className="vc-muted">{e.status} — {e.actor_side} — {new Date(e.created_at).toLocaleString()}</p>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Admin "Orders" (master prompt §23) — every order across every vendor and customer, for support
 * visibility only. Read-only: no refund/payment action lives here; `_settle_payment` inside the
 * existing checkout/transition flows remains the only writer of `Payment` rows. */
function OrdersSection() {
  const { api } = useSession();
  const [items, setItems] = useState<AdminOrderListItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [fulfilment, setFulfilment] = useState<"" | "pickup" | "delivery">("");
  const [selected, setSelected] = useState<string | null>(null);
  const pageSize = 20;

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.orders
      .list({ q: q.trim() || undefined, status: status || undefined, fulfilment: fulfilment || undefined, page, page_size: pageSize })
      .then((r) => {
        if (!isCurrent()) return;
        setItems(r.results);
        setCount(r.count);
      })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, q, status, fulfilment, page, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Orders</h1>
      <p className="vc-muted">Every order across every vendor and customer, for support visibility — read-only; no refund or payment action lives here.</p>
      <div className="vc-row">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} name="q" placeholder="Order #, customer or vendor" />
        <select value={status} onChange={(e) => { setStatus(e.target.value as OrderStatus | ""); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fulfilment} onChange={(e) => { setFulfilment(e.target.value as typeof fulfilment); setPage(1); }} aria-label="Filter by fulfilment">
          <option value="">Pickup + delivery</option>
          <option value="pickup">Pickup</option>
          <option value="delivery">Delivery</option>
        </select>
        <Button variant="secondary" onClick={() => setPage(1)}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="orders" title="No orders" message="Nothing matches this filter." />
      ) : (
        <>
          <table className="a-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Vendor</th><th>Fulfilment</th><th>Status</th><th>Payment</th><th>Total</th><th>Placed</th></tr></thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="is-clickable" {...rowActivation(() => setSelected(o.id))}>
                  <td>{o.number}</td>
                  <td>{o.customer_name || "Customer"}</td>
                  <td>{o.vendor_shop_name} <span className="vc-muted">@{o.vendor_handle}</span></td>
                  <td>{o.fulfilment}</td>
                  <td><StatusBadge kind={orderStatusKind(o.status)} size="sm" label={o.status} /></td>
                  <td>{o.payment_method}{o.payment_status ? ` · ${o.payment_status}` : ""}</td>
                  <td>₹{o.total}</td>
                  <td>{new Date(o.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} />
        </>
      )}
      <AdminOrderDetailModal orderId={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

/** Admin "Audit logs" (master prompt §15) — the first read surface over the append-only `AuditLog`
 * trail every admin/vendor action has been writing to since Phase 1. Deliberately no row action of
 * any kind: the whole point is that nothing, including an admin, can rewrite history here. */
function AuditLogsSection() {
  const { api } = useSession();
  const [items, setItems] = useState<AuditLogItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<unknown>(null);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [targetType, setTargetType] = useState("");
  const pageSize = 30;

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.auditLogs
      .list({ action: action.trim() || undefined, actor: actor.trim() || undefined, target_type: targetType.trim() || undefined, page, page_size: pageSize })
      .then((r) => {
        if (!isCurrent()) return;
        setItems(r.results);
        setCount(r.count);
      })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, action, actor, targetType, page, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Audit logs</h1>
      <p className="vc-muted">
        Every sensitive admin/vendor action ever recorded — append-only; nothing here can be edited or deleted through this or any admin screen.
      </p>
      <div className="vc-row">
        <TextField label="Action" value={action} onChange={(e) => setAction(e.target.value)} name="action" placeholder="e.g. vendor.verified" />
        <TextField label="Actor (phone or id)" value={actor} onChange={(e) => setActor(e.target.value)} name="actor" />
        <TextField label="Target type" value={targetType} onChange={(e) => setTargetType(e.target.value)} name="target_type" placeholder="e.g. vendor" />
        <Button variant="secondary" onClick={() => setPage(1)}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="clock" title="No entries" message="Nothing matches this filter." />
      ) : (
        <>
          <table className="a-table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString()}</td>
                  <td>{e.actor_name ?? "System"}{e.actor_role ? ` (${e.actor_role})` : ""}</td>
                  <td>{e.action}</td>
                  <td>{e.target_type ? `${e.target_type} ${e.target_id}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

/** Admin "Settings" (master prompt §35) — the repository audit found no platform-wide
 * settings/feature-flag model anywhere in the backend (only per-vendor `DeliverySettings` and
 * per-user `PrivacySettings`, both already editable from their own screens, neither a platform
 * config an admin screen could honestly expose). Per the master prompt's own rule — "if a
 * requirement cannot be implemented because the backend does not contain the required business
 * concept: stop and report the exact dependency instead of inventing a new business rule" — this
 * says so plainly instead of showing a form that would save nothing real. */
function SettingsSection() {
  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">Settings</h1>
      <EmptyState
        icon="globe"
        title="No platform-wide settings exist yet"
        message="This backend has no platform-wide configuration model to expose here — only per-vendor delivery settings and per-user privacy settings, both already editable from their own screens. This section will be wired up once a real platform setting exists for it to control."
      />
    </Card>
  );
}

function Login() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [sent, setSent] = useState<{ phone: string; devOtp?: string; resendAfter: number } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      const r = await api.auth.adminPassword(phone, password);
      setSent({ phone, devOtp: r.dev_otp, resendAfter: r.resend_after });
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.status === 401 ? "Invalid phone or password." : errorMessage(e2, t));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <LoginFlow purpose="admin" askName={false} preSent={sent} onSuccess={() => nav("/", { replace: true })} />;
  return (
    <Screen className="vc-center-screen">
      <div className="vc-brand"><span className="vc-brand__mark"><Icon name="shield" size={32} /></span><span className="vc-brand__name">VendorConnect Admin</span></div>
      <form className="vc-stack" onSubmit={submit}>
        <h1 className="vc-h1">{t("admin.login_title")}</h1>
        <TextField label={t("auth.phone")} prefix="+91" type="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} name="phone" />
        <TextField label={t("admin.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} name="password" />
        {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
        <Button type="submit" size="lg" block loading={busy}>{t("admin.continue")}</Button>
      </form>
    </Screen>
  );
}

const AI_DETECTION_STATUSES: AIDetectionStatus[] = ["pending", "done", "failed", "confirmed", "discarded"];

/** Admin "AI Scans" (Phase 10, master prompt §25/§32) — the minimal operational visibility the spec
 * asks for, not a second product database or a moderation queue: read-only, no action column,
 * because there is nothing to action here — `confirmed_listing` (if any) is a real `VendorProduct`
 * already visible wherever listings are, and a `failed`/`discarded` scan is just a fact for staff to
 * see, not something an admin approves or rejects. Deliberately as small as `ReportsSection` above,
 * reusing the same list/filter shape rather than inventing a new one. */
function AIDetectionsSection({ who: _who }: { who: Who }) {
  const { api } = useSession();
  const [items, setItems] = useState<AIDetectionListItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [status, setStatus] = useState<AIDetectionStatus | "">("");
  const [vendor, setVendor] = useState("");

  const guard = useStaleGuard();
  const load = useCallback(() => {
    setErr(null);
    const isCurrent = guard();
    api.admin.aiDetections
      .list({ status: status || undefined, vendor: vendor.trim() || undefined, page_size: 50 })
      .then((r) => { if (isCurrent()) setItems(r.results); })
      .catch((e) => { if (isCurrent()) setErr(e); });
  }, [api, status, vendor, guard]);
  useEffect(load, [load]);

  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">AI Scans</h1>
      <p className="vc-muted">
        Every vendor product scan (barcode/OCR detection) attempted, for operational visibility only — see docs/AI.md
        for what the current provider does and does not do. This never shows anything a vendor hasn't confirmed as a
        second product list; a confirmed scan's listing is the same `VendorProduct` visible everywhere else.
      </p>
      <div className="vc-row">
        <select value={status} onChange={(e) => setStatus(e.target.value as AIDetectionStatus | "")} aria-label="Filter by status">
          <option value="">All statuses</option>
          {AI_DETECTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <TextField label="Vendor handle" value={vendor} onChange={(e) => setVendor(e.target.value)} name="vendor" placeholder="e.g. SHARMA001" />
        <Button variant="secondary" onClick={load}>Search</Button>
      </div>
      {err ? (
        <ErrorState title="Something went wrong" message={errorMessage(err, (k) => k)} onRetry={load} retryLabel="Try again" />
      ) : items === null ? (
        <Loading label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState icon="box" title="No scans" message="Nothing matches this filter." />
      ) : (
        <table className="a-table">
          <thead><tr><th>Vendor</th><th>Detected</th><th>Confidence</th><th>Provider</th><th>Vendor corrected?</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>@{d.vendor_handle}</td>
                <td>{d.top_label ?? "—"}</td>
                <td>{d.top_confidence != null ? `${Math.round(d.top_confidence * 100)}%` : "—"}</td>
                <td>{d.provider ?? "—"}</td>
                <td>{d.vendor_corrected ? "Yes" : "No"}</td>
                <td>
                  <StatusBadge
                    kind={d.status === "done" || d.status === "confirmed" ? "in_stock" : d.status === "pending" ? "low_stock" : "out_of_stock"}
                    size="sm"
                    label={d.status}
                  />
                </td>
                <td>{new Date(d.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Section({ who }: { who: Who }) {
  const { section = "dashboard" } = useParams();
  const s = SECTIONS.find((x) => x.key === section) ?? SECTIONS[0];
  if (s.key === "dashboard") return <DashboardSection />;
  if (s.key === "users") return <UsersSection who={who} />;
  if (s.key === "vendors") return <VendorsSection who={who} />;
  if (s.key === "verification") return <VendorsSection who={who} verificationOnly />;
  if (s.key === "products") return <ProductsSection />;
  if (s.key === "categories") return <CategoriesSection />;
  if (s.key === "orders") return <OrdersSection />;
  if (s.key === "reports") return <ReportsSection who={who} />;
  if (s.key === "posts") return <PostsModerationSection who={who} />;
  if (s.key === "reviews") return <ReviewsModerationSection who={who} />;
  if (s.key === "ai-scans") return <AIDetectionsSection who={who} />;
  if (s.key === "audit-logs") return <AuditLogsSection />;
  if (s.key === "settings") return <SettingsSection />;
  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">{s.label}</h1>
      <EmptyState icon={s.icon} title="Not available" message="This admin section isn't implemented." />
    </Card>
  );
}

function Shell() {
  const { api, logout } = useSession();
  const [who, setWho] = useState<Who | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  useEffect(() => {
    api.admin.whoami().then(setWho).catch((e) => setDenied(e instanceof ApiError && e.status === 403 ? "This session is not an admin session. Sign in with password + code." : errorMessage(e, (k) => k)));
  }, [api]);
  if (denied) return <Screen><Banner tone="error" icon="alert">{denied}</Banner><Button onClick={() => logout()}>Sign in again</Button></Screen>;
  if (!who) return <Loading label="Loading…" />;
  return (
    <div className="a-layout">
      <aside className="a-side">
        <div className="vc-brand" style={{ padding: "0 8px 16px" }}><span className="vc-brand__mark" style={{ width: 40, height: 40 }}><Icon name="shield" /></span><b>Admin</b></div>
        <nav aria-label="Admin">
          {SECTIONS.map((s) => (
            <NavLink key={s.key} to={s.key === "dashboard" ? "/" : `/${s.key}`} end className={({ isActive }) => `a-link ${isActive ? "is-active" : ""}`}>
              <Icon name={s.icon} size={20} /> {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="a-main">
        <header className="a-top">
          <span data-testid="admin-who">Signed in as {who.name || "admin"} · {who.roles.join(", ")}</span>
          <Button variant="ghost" icon="logout" onClick={() => logout()}>Log out</Button>
        </header>
        <Routes>
          <Route path="/" element={<Section who={who} />} />
          <Route path="/:section" element={<Section who={who} />} />
        </Routes>
      </div>
    </div>
  );
}

export function App() {
  const { status } = useSession();
  if (status === "restoring") return <Loading label="Loading…" />;
  return (
    <Routes>
      <Route path="/login" element={status === "authenticated" ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={status === "authenticated" ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
