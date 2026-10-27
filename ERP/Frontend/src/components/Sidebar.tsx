import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Home,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  BarChart3,
  TrendingUp,
  Receipt,
  User,
  Activity,
  CreditCard,
  PanelLeftClose,
  PanelLeftOpen,
  History,
  GitBranch,
  Building2,
  Plus,
  LogOut,
  Wifi,
  Loader2,
  Wallet,
  Banknote,
  ScanLine,
  FileText,
  Clock,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "../lib/utils";
import { useOrganization } from "../context/OrganizationContext";
import { useOrganizationSettings } from "../context/OrganizationSettingsContext";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../lib/api-client";
import type { ISidebarConfig, IFeatureFlags, IOrganizationSettings } from "../types/organizationSettings";

/* ─── Types ─────────────────────────────────────────── */

type Role = "ADMIN" | "BRANCH_MANAGER" | "ACCOUNTANT" | "SELLER";

interface SubNavItem {
  id: string;
  name: string;
  href: string;
  icon: LucideIcon;
}

interface NavItem {
  id: string;
  name: string;
  href: string;
  icon?: LucideIcon;
  type?: "header";
  submenu?: SubNavItem[];
  /** If set, only these roles see the item (denylist below is ignored). */
  allowedRoles?: Role[];
  /** If set, every role except these sees the item. */
  restrictedRoles?: Role[];
  /** If set, item is hidden when this organization sidebar module is toggled off. */
  moduleKey?: keyof ISidebarConfig;
  /** If set, item is hidden when this organization feature flag is toggled off. */
  featureFlag?: keyof IFeatureFlags;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/** A leading (pre-header) item, or a header plus the items that belong to its collapsible section. */
type NavBlock =
  | { kind: "item"; item: NavItem }
  | { kind: "group"; header: NavItem; items: NavItem[] };

/* ─── Navigation configuration ──────────────────────── */

const baseNavigation: NavItem[] = [
  { id: "home", name: "nav.home", href: "/", icon: Home, moduleKey: "home" },
  { id: "dashboard", name: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard, moduleKey: "dashboard" },

  { id: "sales-header", name: "nav.salesHeader", href: "", type: "header" },
  { id: "pos", name: "nav.pos", href: "pos", icon: ShoppingCart, moduleKey: "pos" },
  { id: "shifts", name: "nav.shifts", href: "shifts", icon: Clock },
  { id: "sales", name: "nav.sales", href: "sales", icon: Receipt, moduleKey: "sales" },
  { id: "invoices", name: "Invoices", href: "invoices", icon: FileText, moduleKey: "invoices" },
  { id: "customers", name: "nav.customers", href: "customers", icon: User, moduleKey: "customers" },
  { id: "debt-management", name: "nav.debtManagement", href: "debt", icon: Receipt, moduleKey: "debtManagement" },

  { id: "inventory-header", name: "nav.inventoryHeader", href: "", type: "header" },
  { id: "inventory-all", name: "nav.allInventory", href: "inventory-all", icon: Package, moduleKey: "inventoryAll" },
  { id: "low-stock", name: "nav.lowStock", href: "low-stock", icon: AlertTriangle, moduleKey: "lowStock" },
  { id: "expired", name: "nav.expiredProducts", href: "expired", icon: AlertTriangle, moduleKey: "expiredProducts" },
  { id: "ledger-history", name: "nav.ledgerHistory", href: "ledger-history", icon: History, moduleKey: "stockMovementHistory" },
  { id: "inventory-summary", name: "nav.inventorySummary", href: "inventory-summary", icon: BarChart3, moduleKey: "inventorySummary" },
  { id: "stock-transfers", name: "nav.stockTransfers", href: "stock-transfers", icon: GitBranch, restrictedRoles: ["SELLER"], moduleKey: "stockTransfers", featureFlag: "stockTransfersEnabled" },
  { id: "warehouses", name: "nav.warehouses", href: "warehouses", icon: Building2, restrictedRoles: ["SELLER"], moduleKey: "warehouses", featureFlag: "stockTransfersEnabled" },
  { id: "production", name: "Production & BOM", href: "production", icon: Package, restrictedRoles: ["SELLER"], moduleKey: "production" },

  { id: "orders-header", name: "nav.purchasesHeader", href: "", type: "header" },
  { id: "orders", name: "nav.purchases", href: "purchases", icon: ShoppingCart, moduleKey: "orders" },
  { id: "suppliers", name: "nav.suppliers", href: "suppliers", icon: Users, moduleKey: "suppliers" },
  { id: "supplier-invoices", name: "Supplier Invoices", href: "supplier-invoices", icon: FileText, moduleKey: "supplierInvoices" },
  { id: "scan-invoice", name: "Scan Invoice", href: "scan-invoice", icon: ScanLine, moduleKey: "scanInvoice" },

  { id: "finance-header", name: "nav.financeHeader", href: "", type: "header" },
  { id: "expenses", name: "nav.expenses", href: "expenses", icon: Wallet, moduleKey: "expenses" },
  { id: "payroll", name: "nav.payroll", href: "payroll", icon: Banknote, restrictedRoles: ["SELLER", "BRANCH_MANAGER"], moduleKey: "payroll" },
];

const adminNav: NavItem[] = [
  { id: "users", name: "nav.users", href: "users", icon: Users, moduleKey: "users" },
  { id: "activity-logs", name: "nav.activityLogs", href: "activity-logs", icon: Activity, moduleKey: "activityLogs" },
  { id: "ebm-outbox", name: "EBM Outbox", href: "ebm-outbox", icon: Wifi, moduleKey: "ebmOutbox", featureFlag: "ebmIntegrationEnabled" },
  { id: "fiscal-reports", name: "Fiscal Reports", href: "fiscal-reports", icon: FileText, moduleKey: "ebmOutbox", featureFlag: "ebmIntegrationEnabled" },

  { id: "billing-header", name: "nav.billing", href: "", type: "header" },
  { id: "subscription", name: "nav.subscription", href: "subscription", icon: CreditCard, moduleKey: "subscription" },
  { id: "billing-history", name: "nav.billingHistory", href: "history", icon: Receipt, moduleKey: "billingHistory" },

  { id: "reports-header", name: "nav.reportsHeader", href: "", type: "header" },
  { id: "sales-report", name: "nav.salesReports", href: "sales-reports", icon: TrendingUp, moduleKey: "salesReports" },
  { id: "inventory-report", name: "nav.inventoryReports", href: "inventory-reports", icon: BarChart3, moduleKey: "inventoryReports" },
  { id: "stock-reports", name: "nav.stockReports", href: "stock-reports", icon: Package, moduleKey: "stockReports" },
  { id: "debt-payments-report", name: "nav.debtPayments", href: "debt-payments-report", icon: Receipt, moduleKey: "debtPaymentsReport" },
  { id: "cash-flow-report", name: "nav.cashFlow", href: "cash-flow-report", icon: TrendingUp, moduleKey: "cashFlowReport" },
];

const systemOwnerNav: NavItem[] = [
  { id: "system-owner-header", name: "nav.systemOwner", href: "", type: "header" },
  { id: "system-overview", name: "nav.overview", href: "/dashboard/system-owner/overview", icon: LayoutDashboard },
  { id: "system-subscriptions", name: "nav.subscriptions", href: "/dashboard/system-owner/subscriptions", icon: CreditCard },
  { id: "system-payments", name: "nav.payments", href: "/dashboard/system-owner/payments", icon: Receipt },
  { id: "system-analytics", name: "nav.analytics", href: "/dashboard/system-owner/analytics", icon: BarChart3 },
];

/* ─── Role-based filtering ──────────────────────────── */

function isVisibleForRole(item: NavItem, role?: string): boolean {
  if (item.allowedRoles) return !!role && item.allowedRoles.includes(role as Role);
  if (item.restrictedRoles) return !role || !item.restrictedRoles.includes(role as Role);
  return true;
}

/** Filters a flat nav list by role, dropping any header left with no items under it. */
function filterNavByRole(items: NavItem[], role?: string): NavItem[] {
  const kept = items.filter(item => item.type === "header" || isVisibleForRole(item, role));
  return kept.filter((item, idx) => {
    if (item.type !== "header") return true;
    const next = kept[idx + 1];
    return !!next && next.type !== "header";
  });
}

function isVisibleForSettings(item: NavItem, settings: IOrganizationSettings): boolean {
  if (item.moduleKey && !settings.sidebarConfig[item.moduleKey]) return false;
  if (item.featureFlag && !settings.featureFlags[item.featureFlag]) return false;
  return true;
}

/** Filters a flat nav list by org sidebar/feature settings, dropping any header left with no items under it. */
function filterNavBySettings(items: NavItem[], settings: IOrganizationSettings): NavItem[] {
  const kept = items.filter(item => item.type === "header" || isVisibleForSettings(item, settings));
  return kept.filter((item, idx) => {
    if (item.type !== "header") return true;
    const next = kept[idx + 1];
    return !!next && next.type !== "header";
  });
}

/* ─── Navigation resolver ───────────────────────────── */

function resolveNavigation(
  userRole?: string,
  hasActiveSubscription?: boolean,
  isSystemOwner?: boolean,
  hasOrganization?: boolean,
  settings?: IOrganizationSettings,
): NavItem[] {
  if (isSystemOwner) {
    return systemOwnerNav;
  }

  if (hasOrganization === false) {
    return [{ id: "organizations", name: "nav.organizations", href: "organizations", icon: Building2 }];
  }

  if (hasActiveSubscription === false) {
    return [
      { id: "billing-header", name: "nav.billing", href: "", type: "header" as const },
      { id: "subscription", name: "nav.subscription", href: "subscription", icon: CreditCard },
      { id: "billing-history", name: "nav.billingHistory", href: "history", icon: Receipt },
    ];
  }

  const items = [...baseNavigation];

  if (userRole === "ADMIN") {
    items.push(
      { id: "admin-header", name: "nav.admin", href: "", type: "header" as const },
      { id: "organizations", name: "nav.organizations", href: "organizations", icon: Building2, moduleKey: "organizations" },
      ...adminNav,
    );
  }

  const roleFiltered = filterNavByRole(items, userRole);
  return settings ? filterNavBySettings(roleFiltered, settings) : roleFiltered;
}

/* ─── Component ─────────────────────────────────────── */

export function Sidebar({ isOpen, onClose, onCollapsedChange }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { organization, setOrganization } = useOrganization();
  const { settings: orgSettings } = useOrganizationSettings();
  const { user, isSystemOwner, login, logout, refreshUserProfile } = useAuth();
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [organizations, setOrganizations] = useState<
    { id: number; name: string; businessType: string; role: string; isOwner: boolean }[]
  >([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        setOrgLoading(true);
        const data = await apiClient.getUserOrganizations();
        const orgs = Array.isArray(data) ? data : (data.organizations || []);
        setOrganizations(orgs);
      } catch (err) {
        console.error('Failed to load organizations:', err);
      } finally {
        setOrgLoading(false);
      }
    };
    if (organization) fetchOrgs();
  }, [organization]);

  const handleSelectOrganization = useCallback(async (selectedOrgId: string) => {
    if (String(selectedOrgId) === String(organization?.id)) return;
    const selectedOrg = organizations.find(o => String(o.id) === selectedOrgId);
    if (!selectedOrg) return;
    try {
      setSwitching(true);
      localStorage.removeItem('branch_scope');
      localStorage.removeItem('selected_branch_ids');
      const response = await apiClient.switchOrganization({ organizationId: Number(selectedOrgId) });
      if (response.organization && response.token && response.user) {
        localStorage.setItem('current_organization_id', String(selectedOrgId));
        localStorage.setItem('organization', JSON.stringify({
            ...response.organization,
            role: selectedOrg.role,
            isOwner: selectedOrg.isOwner,
        }));
        setOrganization({
          id: response.organization.id,
          name: response.organization.name,
          businessType: response.organization.businessType,
          address: response.organization.address,
          phone: response.organization.phone,
          email: response.organization.email,
          avatar: response.organization.avatar,
          hasActiveSubscription: response.organization.hasActiveSubscription,
          role: selectedOrg.role,
          isOwner: selectedOrg.isOwner,
        });
        apiClient.setToken(response.token);
        localStorage.setItem('token', response.token);
        login({
          id: String(response.user.id),
          email: response.user.email,
          name: response.user.name,
          token: response.token,
          role: response.user.role,
        });
        await refreshUserProfile();
        if (window.location.pathname.startsWith('/dashboard')) {
          navigate('/dashboard', { replace: true });
          window.location.reload();
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      console.error('Failed to switch organization:', err);
    } finally {
      setSwitching(false);
    }
  }, [organization, organizations, setOrganization, login, refreshUserProfile, navigate]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev;
      onCollapsedChange?.(next);
      return next;
    });
  }, [onCollapsedChange]);

  const toggleSubmenu = useCallback((id: string) => {
    setExpandedMenus(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }, []);

  // Section (header) groups collapse/expand independently and remember the
  // user's preference across reloads. Nothing is collapsed by default so the
  // sidebar looks the same as before until a group is explicitly toggled.
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("sidebar-collapsed-groups");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try {
        localStorage.setItem("sidebar-collapsed-groups", JSON.stringify(next));
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next;
    });
  }, []);

  const isActiveRoute = useCallback(
    (path: string): boolean => {
      if (path === "") return false;
      if (path === "/dashboard") return location.pathname === "/dashboard";
      if (path.startsWith("/")) {
        return location.pathname === path || location.pathname.startsWith(`${path}/`);
      }
      const segments = location.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] === path;
    },
    [location.pathname],
  );

  const navItems = useMemo(
    () =>
      resolveNavigation(
        user?.role,
        organization?.hasActiveSubscription,
        isSystemOwner(),
        organization !== null || !!localStorage.getItem("current_organization_id"),
        orgSettings,
      ),
    [user?.role, organization?.hasActiveSubscription, isSystemOwner, organization, orgSettings],
  );

  // Fold the flat item list into blocks: items before the first header render
  // as-is, everything after a header belongs to that header's collapsible group.
  const navBlocks = useMemo<NavBlock[]>(() => {
    const blocks: NavBlock[] = [];
    let currentGroup: Extract<NavBlock, { kind: "group" }> | null = null;
    for (const item of navItems) {
      if (item.type === "header") {
        currentGroup = { kind: "group", header: item, items: [] };
        blocks.push(currentGroup);
      } else if (currentGroup) {
        currentGroup.items.push(item);
      } else {
        blocks.push({ kind: "item", item });
      }
    }
    return blocks;
  }, [navItems]);

  // If navigation lands on a route inside a collapsed group (deep link, browser
  // back/forward, refresh), auto-expand that group so the active item is visible.
  useEffect(() => {
    const activeGroup = navBlocks.find(
      (b): b is Extract<NavBlock, { kind: "group" }> =>
        b.kind === "group" && b.items.some(i => isActiveRoute(i.href)),
    );
    if (activeGroup && collapsedGroups.includes(activeGroup.header.id)) {
      setCollapsedGroups(prev => prev.filter(id => id !== activeGroup.header.id));
    }
    // Only re-run when the route or the available groups change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navBlocks]);

  const renderNavItem = (item: NavItem) => {
    const isActive = isActiveRoute(item.href);
    const hasSubmenu = !!item.submenu?.length;
    const isExpanded = expandedMenus.includes(item.id);

    return (
      <>
        {hasSubmenu ? (
          <button
            type="button"
            onClick={() => toggleSubmenu(item.id)}
            className={cn(
              "dashboard-nav-item w-full",
              isCollapsed ? "justify-center px-2" : "justify-between px-3",
              isActive
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-200 hover:bg-white/10 hover:text-white",
            )}
            title={isCollapsed ? t(item.name) : undefined}
          >
            <span className={cn("flex min-w-0 items-center gap-3", !isCollapsed && "flex-1")}>
              {item.icon && <item.icon className="h-5 w-5 shrink-0" />}
              {!isCollapsed && <span className="truncate text-left">{t(item.name)}</span>}
            </span>
            {!isCollapsed &&
              (isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 opacity-80" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 opacity-80" />
              ))}
          </button>
        ) : (
          <Link
            to={item.href || "#"}
            onClick={onClose}
            className={cn(
              "dashboard-nav-item",
              isCollapsed ? "justify-center px-2" : "px-3",
              isActive
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-200 hover:bg-white/10 hover:text-white",
            )}
            title={isCollapsed ? t(item.name) : undefined}
          >
            {item.icon && <item.icon className="h-5 w-5 shrink-0" />}
            {!isCollapsed && t(item.name)}
          </Link>
        )}

        {/* Submenu */}
        {hasSubmenu && isExpanded && !isCollapsed && item.submenu && (
          <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/20 pl-2">
            {item.submenu.map(sub => (
              <Link
                key={sub.id}
                to={sub.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActiveRoute(sub.href)
                    ? "bg-white/15 font-medium text-white"
                    : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
              >
                <sub.icon className="h-4 w-4 shrink-0" />
                <span>{t(sub.name)}</span>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  };

  /* ── Render ────────────────────────────────────────── */

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "dashboard-chrome fixed inset-y-0 left-0 z-50 flex transform flex-col border-r shadow-xl transition-all duration-300 ease-in-out lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-16" : "w-64",
        )}
      >
        {/* ── Logo / Organization area ───────────────── */}
        <div className="flex h-14 shrink-0 items-center border-b border-white/15 px-3 lg:px-4">
          {organization ? (
            isSystemOwner() ? (
              <Link
                to="/dashboard/system-owner/overview"
                onClick={onClose}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 transition-colors hover:bg-white/10"
              >
                {organization.avatar ? (
                  <img
                    src={organization.avatar}
                    alt={organization.name}
                    className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/25"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-800/90 ring-1 ring-white/15">
                    <Package className="h-5 w-5 text-white" />
                  </div>
                )}
                {!isCollapsed && (
                  <span className="truncate text-sm font-semibold text-white">{organization.name}</span>
                )}
              </Link>
            ) : !isCollapsed ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={switching || orgLoading}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pr-1 text-left transition-colors hover:bg-white/10"
                  >
                    {organization.avatar ? (
                      <img
                        src={organization.avatar}
                        alt={organization.name}
                        className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/25"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-800/90 ring-1 ring-white/15">
                        <Package className="h-5 w-5 text-white" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{organization.name}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={6}
                  className="w-[220px] overflow-hidden rounded-lg border border-white/20 bg-slate-800 p-1 shadow-xl"
                >
                  {switching || orgLoading ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                      <span className="text-sm text-slate-300">{t('common.loading')}</span>
                    </div>
                  ) : organizations.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400">{t('organizations.noOrganizations')}</div>
                  ) : (
                    <DropdownMenuRadioGroup
                      value={String(organization?.id)}
                      onValueChange={handleSelectOrganization}
                    >
                      {organizations.map(org => (
                        <DropdownMenuRadioItem
                          key={org.id}
                          value={String(org.id)}
                          className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-300 focus:bg-white/10 focus:text-white"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-800/60 ring-1 ring-white/15">
                            <Building2 className="h-4 w-4 text-white" />
                          </div>
                          <span className="flex-1 truncate">{org.name}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {organization.avatar ? (
                  <img
                    src={organization.avatar}
                    alt={organization.name}
                    className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/25"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-800/90 ring-1 ring-white/15">
                    <Package className="h-5 w-5 text-white" />
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-800/90 ring-1 ring-white/15">
                <Package className="h-5 w-5 text-white" />
              </div>
              {!isCollapsed && (
                <span className="truncate text-base font-semibold tracking-tight text-white">
                  {t('common.appName')}
                </span>
              )}
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden rounded-lg p-2 text-blue-100 transition-colors hover:bg-white/10 lg:flex"
              title={isCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            >
              {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable nav area ─────────────────────── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3" id="sidebar-nav">
          <div className={cn("space-y-0.5", isCollapsed ? "px-2" : "px-3")}>
            {navBlocks.map(block => {
              if (block.kind === "item") {
                return <div key={block.item.id}>{renderNavItem(block.item)}</div>;
              }

              // Collapsing a section is a sidebar-expanded-only affordance — in
              // icon-only mode there are no labels to click, so always show items.
              const isGroupCollapsed = !isCollapsed && collapsedGroups.includes(block.header.id);
              // Highlight the category the user is currently inside, so the
              // active main section reads clearly even when its own group is
              // collapsed or has several items.
              const isGroupActive = block.items.some(i => isActiveRoute(i.href));

              return (
                <div key={`grp-${block.header.id}`}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(block.header.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg pb-1.5 pt-4 first:pt-0",
                      isCollapsed ? "px-2" : "px-3",
                    )}
                    aria-expanded={!isGroupCollapsed}
                    aria-current={isGroupActive ? "true" : undefined}
                  >
                    {!isCollapsed && (
                      <>
                        <span className="flex min-w-0 items-center gap-1.5">
                          {isGroupActive && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"
                              aria-hidden="true"
                            />
                          )}
                          <span
                            className={cn(
                              "dashboard-nav-section-label truncate",
                              isGroupActive && "text-sky-300 dark:text-sky-300",
                            )}
                          >
                            {t(block.header.name)}
                          </span>
                        </span>
                        {isGroupCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        )}
                      </>
                    )}
                  </button>
                  {!isGroupCollapsed && (
                    <div className="space-y-0.5">
                      {block.items.map(item => (
                        <div key={item.id}>{renderNavItem(item)}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* ── Create org CTA (no org state) ───────────── */}
        {!organization && !localStorage.getItem("current_organization_id") && !isSystemOwner() && (
          <div className="border-t border-white/15 p-3">
            <Link
              to="/dashboard/organizations"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white p-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
            >
              <div className="rounded-md bg-[#0f2744] p-1 ring-1 ring-slate-600/50">
                <Plus className="h-4 w-4 text-white" />
              </div>
              {!isCollapsed && <span>{t('organizations.createNew')}</span>}
            </Link>
          </div>
        )}

        {/* ── Logout ──────────────────────────────────── */}
        <div className={cn("border-t border-white/15", isCollapsed ? "p-2" : "p-3")}>
          <button
            type="button"
            onClick={logout}
            className={cn(
              "dashboard-nav-item w-full text-red-200 hover:bg-red-600/25 hover:text-white",
              isCollapsed ? "justify-center px-2" : "gap-3 px-3",
            )}
            title={isCollapsed ? t("auth.logout") : undefined}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!isCollapsed && t("auth.logout")}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
