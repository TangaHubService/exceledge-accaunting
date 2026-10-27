import { useState, useEffect, useMemo } from "react";
import { Outlet, useNavigate, useLocation, Navigate } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Sidebar } from "../components/Sidebar";
import { Header } from "../components/Header";
import { SubscriptionRequiredModal } from "../components/SubscriptionRequiredModal";
import { SubscriptionStatusBanner } from "../components/subscription/SubscriptionStatusBanner";
import { VsdcStatusBanner } from "../components/VsdcStatusBanner";
import { AppShellSkeleton } from "../components/ui/app-shell-skeleton";
import { useOrganization } from "../context/OrganizationContext";
import { useAuth } from "../context/AuthContext";
import { ToastContainer } from "react-toastify";
import 'react-toastify/dist/ReactToastify.css';
import { cn } from "../lib/utils";

import { GlobalSearchModal } from "../components/dashboard/GlobalSearchModal";

const SELLER_RESTRICTED_PATHS = [
  "stock-transfers",
  "warehouses",
  "users",
  "subscription",
  "history",
];

function getDashboardSegment(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const dashIdx = segments.indexOf("dashboard");
  if (dashIdx === -1 || dashIdx + 1 >= segments.length) return null;
  return segments[dashIdx + 1];
}

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const { organization } = useOrganization();
  const { user, isSystemOwner, isAuthenticated, isLoading } = useAuth();

  const dashboardSegment = useMemo(
    () => getDashboardSegment(location.pathname),
    [location.pathname],
  );

  const hasOrganization =
    organization !== null || localStorage.getItem('current_organization_id') !== null;

  /* Wait for auth to settle before rendering the shell or redirecting */
  useEffect(() => {
    if (!isAuthenticated) return;
    /* Give the auth context a tick to hydrate */
    const timer = setTimeout(() => setAuthReady(true), 100);
    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  /* Redirect SELLER away from restricted routes */
  useEffect(() => {
    if (!authReady) return;
    if (user?.role === "SELLER" && dashboardSegment && SELLER_RESTRICTED_PATHS.includes(dashboardSegment)) {
      navigate("/dashboard", { replace: true });
    }
  }, [authReady, user?.role, dashboardSegment, navigate]);

  useEffect(() => {
    if (!authReady) return;
    /* Never redirect a system owner away from system-owner routes */
    if (location.pathname.startsWith('/dashboard/system-owner')) return;
    if (isAuthenticated && !isSystemOwner() && !hasOrganization) {
      if (location.pathname !== '/create-organization') {
        navigate('/create-organization', { replace: true });
      }
    }
  }, [authReady, isAuthenticated, isSystemOwner, hasOrganization, location.pathname, navigate]);

  /* ── Auth is still initializing — show skeleton ────── */
  if (isLoading) {
    return <AppShellSkeleton sidebarCollapsed={sidebarCollapsed} />;
  }

  /* ── Not authenticated — redirect ─────────────────── */
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  /* ── Auth settled but layout not yet ready — show skeleton ── */
  if (!authReady) {
    return <AppShellSkeleton sidebarCollapsed={sidebarCollapsed} />;
  }

  /* ── Full shell ────────────────────────────────────── */
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCollapsedChange={setSidebarCollapsed}
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-all duration-300",
          sidebarCollapsed ? "lg:pl-16" : "lg:pl-64",
        )}
      >
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
        />

        {/* Toast container — rendered above the scrollable content */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored"
          className="mt-14"
        />

        {/* Status banners */}
        <VsdcStatusBanner />
        <SubscriptionStatusBanner
          warningLevel={organization?.subscriptionWarningLevel}
          warningMessage={organization?.subscriptionWarningMessage}
          graceDayLabel={organization?.graceDayLabel}
        />

        {/* Subscription-required modal (replaces the old inline banner) */}
        <SubscriptionRequiredModal
          hasActiveSubscription={organization?.hasActiveSubscription}
          subscriptionStatus={organization?.subscriptionStatus}
        />

        {/* ── Scrollable content area ─────────────────── */}
        <main
          className="flex-1 overflow-y-auto"
          id="dashboard-main-content"
        >
          <div className="dashboard-main-padding min-h-full">
            <Breadcrumbs />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
