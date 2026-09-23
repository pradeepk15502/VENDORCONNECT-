import { ApiError, useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage, LoginFlow } from "@vc/shell";
import { Banner, Button, Card, EmptyState, Icon, Loading, Screen, TextField, type IconName } from "@vc/ui";
import { useEffect, useState, type FormEvent } from "react";
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
  { key: "analytics", label: "Analytics", icon: "refresh" },
  { key: "settings", label: "Settings", icon: "globe" },
];

type Who = { id: string; name: string; roles: string[]; permissions: string[] };

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

function Section() {
  const { section = "dashboard" } = useParams();
  const s = SECTIONS.find((x) => x.key === section) ?? SECTIONS[0];
  return (
    <Card className="vc-stack">
      <h1 className="vc-h1">{s.label}</h1>
      <EmptyState icon={s.icon} title="Coming in Phase 11" message="Permission-controlled admin tools are built on the audited admin API." />
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
          <Route path="/" element={<Section />} />
          <Route path="/:section" element={<Section />} />
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
