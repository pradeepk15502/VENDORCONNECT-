import { useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { LanguageScreen, LoginFlow } from "@vc/shell";
import { BottomNav, Button, Icon, Loading, Screen, type NavItem } from "@vc/ui";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DashboardScreen } from "./screens/DashboardScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { ShopScreen } from "./screens/ShopScreen";
import { VendorIdScreen } from "./screens/VendorIdScreen";

function Welcome() {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <Screen className="vc-center-screen">
      <div className="vc-brand">
        <span className="vc-brand__mark"><Icon name="store" size={36} /></span>
        <span className="vc-brand__name">{t("app.name")}</span>
      </div>
      <h1 className="vc-h1">{t("vendor.tagline")}</h1>
      <div className="v-hero" aria-hidden="true"><Icon name="store" size={120} /></div>
      <div className="vc-spacer" />
      <Button size="lg" block onClick={() => nav("/login")}>{t("common.continue")}</Button>
    </Screen>
  );
}

export function App() {
  const { t, hasChosen } = useI18n();
  const { status, me } = useSession();
  const nav = useNavigate();
  const loc = useLocation();

  if (status === "restoring") return <Loading label={t("common.loading")} />;
  if (!hasChosen && loc.pathname !== "/language") return <Navigate to="/language" replace />;

  const tabs: NavItem[] = [
    { key: "home", label: t("nav.home"), icon: "home", href: "/" },
    { key: "products", label: t("nav.products"), icon: "box", href: "/products" },
    { key: "orders", label: t("nav.orders"), icon: "orders", href: "/orders" },
    { key: "messages", label: t("nav.messages"), icon: "chat", href: "/messages" },
    { key: "shop", label: t("nav.shop"), icon: "store", href: "/shop" },
  ];
  const active = tabs.find((x) => x.href !== "/" && loc.pathname.startsWith(x.href))?.key ?? "home";

  const authed = (el: ReactNode, nav_ = true) => {
    if (status !== "authenticated") return <Navigate to="/welcome" replace />;
    if (!me?.vendor) return <Navigate to="/setup" replace />;
    return nav_ ? (<>{el}<BottomNav items={tabs} active={active} onNavigate={(h) => nav(h)} /></>) : el;
  };

  return (
    <Routes>
      <Route path="/language" element={<LanguageScreen brand={t("app.name")} onDone={() => nav("/welcome")} />} />
      <Route path="/welcome" element={status === "authenticated" ? <Navigate to="/" replace /> : <Welcome />} />
      <Route path="/login" element={<LoginFlow onBack={() => nav("/welcome")} onSuccess={(r) => nav(r.user.vendor ? "/" : "/setup", { replace: true })} />} />
      <Route path="/setup" element={status !== "authenticated" ? <Navigate to="/welcome" replace /> : <OnboardingScreen onCreated={() => nav("/vendor-id", { replace: true })} />} />
      <Route path="/vendor-id" element={authed(<VendorIdScreen onDone={() => nav("/", { replace: true })} />, false)} />
      <Route path="/" element={authed(<DashboardScreen />)} />
      <Route path="/products" element={authed(<PlaceholderScreen title={t("nav.products")} icon="box" />)} />
      <Route path="/orders" element={authed(<PlaceholderScreen title={t("nav.orders")} icon="orders" />)} />
      <Route path="/messages" element={authed(<PlaceholderScreen title={t("nav.messages")} icon="chat" />)} />
      <Route path="/shop" element={authed(<ShopScreen />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
