import { useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { LanguageScreen, LoginFlow, SplashScreen } from "@vc/shell";
import { BottomNav, Loading, type NavItem } from "@vc/ui";
import { useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { RoleSelectScreen } from "./RoleSelectScreen";
import { flags, loadPlace, type Place } from "./customer/location";
import { AddressBookScreen } from "./customer/screens/AddressBookScreen";
import { AddressFormScreen } from "./customer/screens/AddressFormScreen";
import { CartScreen } from "./customer/screens/CartScreen";
import { CheckoutScreen } from "./customer/screens/CheckoutScreen";
import { ChatScreen as CustomerChatScreen } from "./customer/screens/ChatScreen";
import { FollowingScreen } from "./customer/screens/FollowingScreen";
import { HomeScreen } from "./customer/screens/HomeScreen";
import { IntroScreen } from "./customer/screens/IntroScreen";
import { LocationScreen } from "./customer/screens/LocationScreen";
import { MessagesScreen as CustomerMessagesScreen } from "./customer/screens/MessagesScreen";
import { MyReviewsScreen } from "./customer/screens/MyReviewsScreen";
import { NotificationsScreen as CustomerNotificationsScreen } from "./customer/screens/NotificationsScreen";
import { OrderTrackingScreen } from "./customer/screens/OrderTrackingScreen";
import { OrdersScreen as CustomerOrdersScreen } from "./customer/screens/OrdersScreen";
import { PostDetailScreen } from "./customer/screens/PostDetailScreen";
import { ProductDetailScreen } from "./customer/screens/ProductDetailScreen";
import { ProfileScreen } from "./customer/screens/ProfileScreen";
import { SearchScreen } from "./customer/screens/SearchScreen";
import { VendorProfileScreen } from "./customer/screens/VendorProfileScreen";
import { VendorsScreen } from "./customer/screens/VendorsScreen";
import { getActiveRole, setActiveRole, type ActiveRole } from "./role";
import { ChatScreen as VendorChatScreen } from "./vendor/screens/ChatScreen";
import { DashboardScreen } from "./vendor/screens/DashboardScreen";
import { DeliverySettingsScreen } from "./vendor/screens/DeliverySettingsScreen";
import { MessagesScreen as VendorMessagesScreen } from "./vendor/screens/MessagesScreen";
import { NotificationsScreen as VendorNotificationsScreen } from "./vendor/screens/NotificationsScreen";
import { OnboardingScreen } from "./vendor/screens/OnboardingScreen";
import { OrderDetailScreen as VendorOrderDetailScreen } from "./vendor/screens/OrderDetailScreen";
import { OrdersScreen as VendorOrdersScreen } from "./vendor/screens/OrdersScreen";
import { ShopScreen } from "./vendor/screens/ShopScreen";
import { VendorIdScreen } from "./vendor/screens/VendorIdScreen";
import { VendorPostFormScreen } from "./vendor/screens/VendorPostFormScreen";
import { VendorPostsScreen } from "./vendor/screens/VendorPostsScreen";
import { VendorProductFormScreen } from "./vendor/screens/VendorProductFormScreen";
import { VendorProductsScreen } from "./vendor/screens/VendorProductsScreen";
import { VendorScanConfirmScreen } from "./vendor/screens/VendorScanConfirmScreen";
import { VendorScanScreen } from "./vendor/screens/VendorScanScreen";
import { VendorReviewsScreen } from "./vendor/screens/VendorReviewsScreen";

/** Only same-app paths: blocks "//evil.com", "/\\evil.com" and absolute URLs. */
export const safeInternalPath = (p?: string) => (p && /^\/(?![/\\])[\w\-/@?=&.%]*$/.test(p) ? p : "/");

const SPLASH_KEY = "vc.splash";

export function App() {
  const { t, hasChosen } = useI18n();
  const { status, me } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [place, setPlace] = useState<Place | null>(loadPlace);
  const [splashDone, setSplashDone] = useState(() => sessionStorage.getItem(SPLASH_KEY) === "1");
  const [role, setRole] = useState<ActiveRole | null>(getActiveRole());

  // A shared shop/post/product link opens for anyone, first-run or not, whichever role (or no
  // role) they're in — the same deep-link exemption already covered /v/ shop links; without this,
  // someone tapping a shared post or product link with a fresh browser (no language/role chosen
  // yet) got redirected to the language picker and lost the page they came for (Phase 9: posts and
  // products are meant to be just as shareable as a shop profile — master prompt §12/§15/§33).
  const isPublicShopLink = loc.pathname.startsWith("/v/") || loc.pathname.startsWith("/posts/") || loc.pathname.startsWith("/listings/");

  if (status === "restoring") return <Loading label={t("common.loading")} />;

  // One brand moment per browser session, shown before language/role.
  if (!splashDone) {
    return (
      <SplashScreen
        brand={t("app.name")}
        tagline={t("splash.tagline")}
        onDone={() => { sessionStorage.setItem(SPLASH_KEY, "1"); setSplashDone(true); }}
      />
    );
  }

  // First-run gate: language -> "how do you want to use VendorConnect?" -> that role's own flow.
  // VendorConnect is one app; role only decides which half of it shows next (see ARCHITECTURE D4/D20).
  if (!hasChosen && loc.pathname !== "/language" && !isPublicShopLink) return <Navigate to="/language" replace />;
  if (!role && loc.pathname !== "/role" && loc.pathname !== "/language" && !isPublicShopLink) return <Navigate to="/role" replace />;

  // Persists the choice (like language) and updates local state so route guards see it immediately —
  // a plain localStorage write wouldn't re-render this component.
  function persistRole(r: ActiveRole) {
    setActiveRole(r);
    setRole(r);
  }

  function chooseRole(r: ActiveRole) {
    persistRole(r);
    if (r === "vendor") {
      nav("/login");
      return;
    }
    nav(flags.get("intro") ? (place ? "/" : "/welcome/location") : "/welcome/intro");
  }

  const customerTabs: NavItem[] = [
    { key: "home", label: t("nav.home"), icon: "home", href: "/" },
    { key: "search", label: t("nav.search"), icon: "search", href: "/search" },
    { key: "vendors", label: t("nav.vendors"), icon: "store", href: "/vendors" },
    { key: "cart", label: t("nav.cart"), icon: "cart", href: "/cart" },
    { key: "profile", label: t("nav.profile"), icon: "user", href: "/profile" },
  ];
  const vendorTabs: NavItem[] = [
    { key: "home", label: t("nav.home"), icon: "home", href: "/vendor" },
    { key: "products", label: t("nav.products"), icon: "box", href: "/vendor/products" },
    { key: "orders", label: t("nav.orders"), icon: "orders", href: "/vendor/orders" },
    { key: "messages", label: t("nav.messages"), icon: "chat", href: "/vendor/messages" },
    { key: "shop", label: t("nav.shop"), icon: "store", href: "/vendor/shop" },
  ];
  const activeCustomerTab = customerTabs.find((x) => x.href !== "/" && loc.pathname.startsWith(x.href))?.key ?? "home";
  const activeVendorTab = vendorTabs.find((x) => x.href !== "/vendor" && loc.pathname.startsWith(x.href))?.key ?? "home";

  const withCustomerNav = (el: ReactNode) => {
    if (role !== "customer") return <Navigate to="/vendor" replace />;
    if (!flags.get("intro")) return <Navigate to="/welcome/intro" replace />;
    if (!place) return <Navigate to="/welcome/location" replace />;
    return (
      <>
        {el}
        <BottomNav items={customerTabs} active={activeCustomerTab} onNavigate={(h) => nav(h)} />
      </>
    );
  };

  // Cart/orders/notifications are real, account-scoped data (Phase 8) — unlike browsing, they need
  // a signed-in customer, so these two guards send an anonymous "login skipped" visitor to /login
  // first (mirrors /chat/:chatId's inline guard below).
  const withCustomerAuthedNav = (el: ReactNode) => {
    if (role !== "customer") return <Navigate to="/vendor" replace />;
    if (!flags.get("intro")) return <Navigate to="/welcome/intro" replace />;
    if (!place) return <Navigate to="/welcome/location" replace />;
    if (status !== "authenticated") return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
    return (
      <>
        {el}
        <BottomNav items={customerTabs} active={activeCustomerTab} onNavigate={(h) => nav(h)} />
      </>
    );
  };
  const customerAuthed = (el: ReactNode) => {
    if (role !== "customer") return <Navigate to="/vendor" replace />;
    if (status !== "authenticated") return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
    return el;
  };

  const vendorAuthed = (el: ReactNode, withNav = true) => {
    if (role !== "vendor") return <Navigate to="/" replace />;
    if (status !== "authenticated") return <Navigate to="/login" replace />;
    if (!me?.vendor) return <Navigate to="/vendor/setup" replace />;
    return withNav ? (<>{el}<BottomNav items={vendorTabs} active={activeVendorTab} onNavigate={(h) => nav(h)} /></>) : el;
  };

  return (
    <Routes>
      <Route path="/language" element={<LanguageScreen brand={t("app.name")} onDone={() => nav("/role")} />} />
      <Route path="/role" element={<RoleSelectScreen onSelect={chooseRole} />} />
      <Route
        path="/login"
        element={
          <LoginFlow
            onBack={() => {
              if (role === "vendor") {
                nav("/role");
                return;
              }
              flags.set("login_skipped");
              nav("/");
            }}
            onSuccess={(r) => {
              if (role === "vendor") {
                nav(r.user.vendor ? "/vendor" : "/vendor/setup", { replace: true });
                return;
              }
              nav(safeInternalPath((loc.state as { from?: string } | null)?.from), { replace: true });
            }}
          />
        }
      />

      {/* customer */}
      <Route path="/welcome/intro" element={<IntroScreen onDone={() => { flags.set("intro"); nav(place ? "/" : "/welcome/location"); }} />} />
      <Route
        path="/welcome/location"
        element={<LocationScreen onDone={(p) => { setPlace(p); nav(status === "authenticated" || flags.get("login_skipped") ? "/" : "/login"); }} />}
      />
      <Route path="/" element={withCustomerNav(<HomeScreen place={place!} />)} />
      <Route path="/notifications" element={withCustomerAuthedNav(<CustomerNotificationsScreen />)} />
      <Route path="/search" element={withCustomerNav(<SearchScreen place={place!} />)} />
      <Route path="/vendors" element={withCustomerNav(<VendorsScreen place={place!} />)} />
      <Route path="/cart" element={withCustomerAuthedNav(<CartScreen />)} />
      <Route path="/profile" element={withCustomerNav(<ProfileScreen place={place!} onChangePlace={() => nav("/welcome/location")} onSwitchRole={persistRole} />)} />
      <Route path="/messages" element={withCustomerNav(<CustomerMessagesScreen />)} />
      <Route
        path="/chat/:chatId"
        element={
          role !== "customer" ? <Navigate to="/" replace /> :
          status !== "authenticated" ? <Navigate to="/login" replace /> :
          <CustomerChatScreen />
        }
      />
      <Route path="/v/:handle" element={<VendorProfileScreen />} />
      <Route path="/posts/:postId" element={<PostDetailScreen />} />
      <Route path="/listings/:id" element={<ProductDetailScreen />} />
      <Route path="/checkout/:vendor" element={customerAuthed(<CheckoutScreen />)} />
      <Route path="/orders" element={customerAuthed(<CustomerOrdersScreen />)} />
      <Route path="/orders/:orderId" element={customerAuthed(<OrderTrackingScreen />)} />
      <Route path="/addresses" element={customerAuthed(<AddressBookScreen />)} />
      <Route path="/addresses/new" element={customerAuthed(<AddressFormScreen />)} />
      <Route path="/addresses/:addressId/edit" element={customerAuthed(<AddressFormScreen />)} />
      <Route path="/following" element={customerAuthed(<FollowingScreen place={place ?? undefined} />)} />
      <Route path="/reviews" element={customerAuthed(<MyReviewsScreen />)} />

      {/* vendor */}
      <Route
        path="/vendor/setup"
        element={
          role !== "vendor" ? <Navigate to="/" replace /> :
          status !== "authenticated" ? <Navigate to="/login" replace /> :
          <OnboardingScreen onCreated={() => nav("/vendor/id", { replace: true })} />
        }
      />
      <Route path="/vendor/id" element={vendorAuthed(<VendorIdScreen onDone={() => nav("/vendor", { replace: true })} />, false)} />
      <Route path="/vendor" element={vendorAuthed(<DashboardScreen />)} />
      <Route path="/vendor/notifications" element={vendorAuthed(<VendorNotificationsScreen />)} />
      <Route path="/vendor/products" element={vendorAuthed(<VendorProductsScreen />)} />
      <Route path="/vendor/products/new" element={vendorAuthed(<VendorProductFormScreen />, false)} />
      <Route path="/vendor/products/:id/edit" element={vendorAuthed(<VendorProductFormScreen />, false)} />
      <Route path="/vendor/products/scan" element={vendorAuthed(<VendorScanScreen />, false)} />
      <Route path="/vendor/products/scan/:id" element={vendorAuthed(<VendorScanConfirmScreen />, false)} />
      <Route path="/vendor/posts" element={vendorAuthed(<VendorPostsScreen />, false)} />
      <Route path="/vendor/posts/new" element={vendorAuthed(<VendorPostFormScreen />, false)} />
      <Route path="/vendor/posts/:id/edit" element={vendorAuthed(<VendorPostFormScreen />, false)} />
      <Route path="/vendor/reviews" element={vendorAuthed(<VendorReviewsScreen />, false)} />
      <Route path="/vendor/orders" element={vendorAuthed(<VendorOrdersScreen />)} />
      <Route path="/vendor/orders/:orderId" element={vendorAuthed(<VendorOrderDetailScreen />, false)} />
      <Route path="/vendor/messages" element={vendorAuthed(<VendorMessagesScreen />)} />
      <Route path="/vendor/messages/:chatId" element={vendorAuthed(<VendorChatScreen />, false)} />
      <Route path="/vendor/shop" element={vendorAuthed(<ShopScreen onSwitchRole={persistRole} />)} />
      <Route path="/vendor/shop/delivery" element={vendorAuthed(<DeliverySettingsScreen />, false)} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
