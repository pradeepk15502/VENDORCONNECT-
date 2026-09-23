import { useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { LanguageScreen, LoginFlow } from "@vc/shell";
import { BottomNav, Loading, type NavItem } from "@vc/ui";
import { useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { flags, loadPlace, type Place } from "./location";
import { CartScreen } from "./screens/CartScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { IntroScreen } from "./screens/IntroScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { VendorProfileScreen } from "./screens/VendorProfileScreen";
import { VendorsScreen } from "./screens/VendorsScreen";

/** Only same-app paths: blocks "//evil.com", "/\\evil.com" and absolute URLs. */
export const safeInternalPath = (p?: string) => (p && /^\/(?![/\\])[\w\-/@?=&.%]*$/.test(p) ? p : "/");

export function App() {
  const { t, hasChosen } = useI18n();
  const { status } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [place, setPlace] = useState<Place | null>(loadPlace);

  if (status === "restoring") return <Loading label={t("common.loading")} />;

  // First-run gate: language → intro → location. Login is optional for browsing (see ARCHITECTURE).
  // Shared shop links (/v/HANDLE) open directly, even on first run.
  if (!hasChosen && loc.pathname !== "/welcome/language" && !loc.pathname.startsWith("/v/")) return <Navigate to="/welcome/language" replace />;

  const tabs: NavItem[] = [
    { key: "home", label: t("nav.home"), icon: "home", href: "/" },
    { key: "search", label: t("nav.search"), icon: "search", href: "/search" },
    { key: "vendors", label: t("nav.vendors"), icon: "store", href: "/vendors" },
    { key: "cart", label: t("nav.cart"), icon: "cart", href: "/cart" },
    { key: "profile", label: t("nav.profile"), icon: "user", href: "/profile" },
  ];
  const active = tabs.find((x) => x.href !== "/" && loc.pathname.startsWith(x.href))?.key ?? "home";

  const withNav = (el: ReactNode) => {
    if (!flags.get("intro")) return <Navigate to="/welcome/intro" replace />;
    if (!place) return <Navigate to="/welcome/location" replace />;
    return (
      <>
        {el}
        <BottomNav items={tabs} active={active} onNavigate={(h) => nav(h)} />
      </>
    );
  };

  return (
    <Routes>
      <Route path="/welcome/language" element={<LanguageScreen brand={t("app.name")} onDone={() => nav("/welcome/intro")} />} />
      <Route path="/welcome/intro" element={<IntroScreen onDone={() => { flags.set("intro"); nav(place ? "/" : "/welcome/location"); }} />} />
      <Route path="/welcome/location" element={<LocationScreen onDone={(p) => { setPlace(p); nav(status === "authenticated" || flags.get("login_skipped") ? "/" : "/login"); }} />} />
      <Route
        path="/login"
        element={
          <LoginFlow
            onBack={() => { flags.set("login_skipped"); nav("/"); }}
            onSuccess={() => nav(safeInternalPath((loc.state as { from?: string } | null)?.from), { replace: true })}
          />
        }
      />
      <Route path="/" element={withNav(<HomeScreen place={place!} />)} />
      <Route path="/search" element={withNav(<SearchScreen />)} />
      <Route path="/vendors" element={withNav(<VendorsScreen />)} />
      <Route path="/cart" element={withNav(<CartScreen />)} />
      <Route path="/profile" element={withNav(<ProfileScreen place={place!} onChangePlace={() => nav("/welcome/location")} />)} />
      <Route path="/v/:handle" element={<VendorProfileScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
