import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense } from "react";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { Loading } from "./components/Loading";
import { Dashboard } from "./pages/Dashboard";
import Login from "./pages/auth/login";
import AccountingHandoff from "./pages/auth/AccountingHandoff";
import Signup from "./pages/auth/SignUp";
import CreateOrganization from "./pages/CreateOrganization";
import { InventoryManagement } from "./pages/dashboard/InventoryManagement";
import { ProductionPage } from "./pages/dashboard/inventory/ProductionPage";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "./components/ui/tooltip";
import { OrganizationProvider } from "./context/OrganizationContext";
import { OrganizationSettingsProvider } from "./context/OrganizationSettingsContext";
import { BranchProvider } from "./context/BranchContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import SelectOrganization from "./pages/auth/SelectOrganization";
import { ToastProvider, ToastViewport } from "./components/ui/toast";
import LowStock from "./pages/dashboard/inventory/LowStock";
import ExpiringProducts from "./pages/dashboard/inventory/ExpiringProducts";
import ExpiredProduct from "./pages/dashboard/inventory/ExpiredProduct";
import { SalesReport } from "./pages/dashboard/reports/sells";
import { InventoryReport } from "./pages/dashboard/reports/Inventory";
import { PaidDebtReport } from "./pages/dashboard/reports/PaidDebtReport";
import { CashFlowReport } from "./pages/dashboard/reports/CashFlowReport";
import { StockReports } from "./pages/dashboard/reports/StockReports";
import { OrganizationConfig } from "./pages/dashboard/organization/OrganizationConfig";
import { CustomerManagement } from "./pages/dashboard/CustomerManagement";
import { UserManagement } from "./pages/dashboard/users/UserManagement";
import LedgerHistoryPage from "./pages/dashboard/inventory/LedgerHistoryPage";
import InventorySummaryDashboard from "./pages/dashboard/inventory/InventorySummaryDashboard";
import StockTransfersPage from "./pages/dashboard/inventory/StockTransfersPage";
import WarehouseManagement from "./pages/dashboard/inventory/WarehouseManagement";

import { AcceptInvitationPage } from "./pages/auth/AcceptInvitation";
import { SuppliersPage } from "./pages/dashboard/suppliers/SuppliersPage";
import { RraPurchasesPage } from "./pages/dashboard/purchases/RraPurchasesPage";
import { ChangePasswordPage } from "./pages/auth/ChangePassword";
import LandingPage from "./pages/LandingPage";
import SalesPage from "./pages/dashboard/sales/sales";
import ShiftSummaryPage from "./pages/dashboard/shifts/ShiftSummaryPage";
import { SubscriptionProvider } from "./context/SubscriptionContext";
import SubscriptionPage from "./pages/SubscriptionPage";
import SubscriptionSuccess from "./pages/PaymentCompleted";

import ActivityLogs from "./pages/dashboard/ActivityLogs";
import { Profile } from "./pages/dashboard/Profile";
import { SystemOwnerDashboard } from "./pages/SystemOwner";
import VerificationPage from "./pages/auth/VerificationPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import SalesForm from "./pages/dashboard/sales/pos";
import { EbmOutboxDashboard } from "./pages/dashboard/ebm/EbmOutboxDashboard";
import { FiscalReportsPage } from "./pages/dashboard/ebm/FiscalReportsPage";
import InvoicePage from "./pages/dashboard/invoice/InvoicePage";
import InvoicesListPage from "./pages/dashboard/invoice/InvoicesListPage";
import DebtManagement from "./pages/dashboard/dept";
import SubscriptionManagementPage from "./pages/billing/SubscriptionManagementPage";
import BillingHistoryPage from "./pages/billing/BillingHistoryPage";
import OrganizationsPage from "./pages/dashboard/organizations/OrganizationsPage";
import { PesapalCallback } from "./pages/PesapalCallback";
import ExpensesPage from "./pages/dashboard/expenses/ExpensesPage";
import PayrollPage from "./pages/dashboard/payroll/PayrollPage";
import { SupplierInvoicesPage } from "./pages/dashboard/inventory/SupplierInvoicesPage";
import { ScanInvoicePage } from "./pages/dashboard/inventory/ScanInvoicePage";

// Protected Route for System Owners
const ProtectedSystemOwnerRoute = ({ children }: { children: React.ReactNode }) => {
  const { isSystemOwner, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isSystemOwner()) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};


function App() {
  return (
    <TooltipProvider>
    <ThemeProvider>
      <AuthProvider>
        <OrganizationProvider>
          <OrganizationSettingsProvider>
          <BranchProvider>
            <SubscriptionProvider>
              <BrowserRouter>
                <Suspense fallback={<Loading />}>
                  <Routes>
                    {/* Public / Unprotected routes — the landing page is always shown at
                        "/" for both signed-in and signed-out visitors, no auth redirect. */}
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/landing" element={<LandingPage />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/accounting-handoff" element={<AccountingHandoff />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/verify" element={<VerificationPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/change-password" element={<ChangePasswordPage />} />
                    <Route
                      path="/create-organization"
                      element={<CreateOrganization />}
                    />
                    <Route
                      path="/select-organization"
                      element={<SelectOrganization />}
                    />
                    <Route path="/subscription" element={<SubscriptionPage />} />
                    <Route path="/accept-invite" element={<AcceptInvitationPage />} />
                    <Route path="/subscription/success" element={<SubscriptionSuccess />} />
                    <Route path="/subscription/callback" element={<PesapalCallback />} />

                    {/* Redirect old system owner routes to new dashboard routes */}
                    <Route path="/my-system" element={<Navigate to="/dashboard/system-owner" replace />} />
                    <Route path="/my-system/overview" element={<Navigate to="/dashboard/system-owner/overview" replace />} />
                    <Route path="/my-system/organizations" element={<Navigate to="/dashboard/system-owner/subscriptions" replace />} />
                    <Route path="/my-system/subscriptions" element={<Navigate to="/dashboard/system-owner/subscriptions" replace />} />
                    <Route path="/my-system/payments" element={<Navigate to="/dashboard/system-owner/payments" replace />} />
                    <Route path="/my-system/analytics" element={<Navigate to="/dashboard/system-owner/analytics" replace />} />

                    {/* Protected / Dashboard routes */}
                    <Route path="dashboard" element={<DashboardLayout />}>
                      <Route index element={<Dashboard />} />
                      <Route path="customers" element={<CustomerManagement />} />
                      <Route path="inventory-all" element={<InventoryManagement />} />
                      <Route path="low-stock" element={<LowStock />} />
                      <Route path="expiring-products" element={<ExpiringProducts />} />
                      <Route path="expired" element={<ExpiredProduct />} />
                      <Route path="sales-reports" element={<SalesReport />} />
                      <Route path="inventory-reports" element={<InventoryReport />} />
                      <Route path="debt-payments-report" element={<PaidDebtReport />} />
                      <Route path="cash-flow-report" element={<CashFlowReport />} />
                      <Route path="stock-reports" element={<StockReports />} />
                      <Route path="purchases-report" element={<Navigate to="/dashboard/fiscal-reports?tab=detail" replace />} />
                      <Route path="ledger-history" element={<LedgerHistoryPage />} />
                      <Route path="inventory-summary" element={<InventorySummaryDashboard />} />
                      <Route path="stock-transfers" element={<StockTransfersPage />} />
                      <Route path="warehouses" element={<WarehouseManagement />} />
                      <Route path="sales" element={<SalesPage />} />
                      <Route path="sales/:id" element={<Navigate to="/dashboard/sales" replace />} />
                      <Route path="invoices" element={<InvoicesListPage />} />
                      <Route path="shifts" element={<ShiftSummaryPage />} />
                      <Route path="open-shift" element={<Navigate to="shifts" replace />} />
                      <Route path="organization-config" element={<OrganizationConfig />} />

                      {/* Redirect legacy routes */}
                      <Route path="branches" element={<Navigate to="../organization-config" replace />} />
                      <Route path="settings" element={<Navigate to="../organization-config" replace />} />
                      <Route path="pos" element={<SalesForm />} />
                      <Route path="invoice/:id" element={<InvoicePage />} />
                      <Route path="users" element={<UserManagement />} />
                      <Route path="activity-logs" element={<ActivityLogs />} />
                      <Route path="ebm-outbox" element={<EbmOutboxDashboard />} />
                      <Route path="fiscal-reports" element={<FiscalReportsPage />} />
                      <Route path="profile" element={<Profile />} />
                      <Route path="suppliers" element={<SuppliersPage />} />
                      <Route path="purchases" element={<RraPurchasesPage />} />
                      <Route path="import-declarations" element={<Navigate to="/dashboard/fiscal-reports?tab=imports" replace />} />
                      <Route path="orders" element={<Navigate to="/dashboard/purchases" replace />} />
                      <Route path="orders/*" element={<Navigate to="/dashboard/purchases" replace />} />
                      <Route path="debt" element={<DebtManagement />} />
                      <Route path="expenses" element={<ExpensesPage />} />
                      <Route path="payroll" element={<PayrollPage />} />
                      <Route path="organizations" element={<OrganizationsPage />} />
                      <Route path="supplier-invoices" element={<SupplierInvoicesPage />} />
                      <Route path="scan-invoice" element={<ScanInvoicePage />} />
                      <Route path="scan-invoice/:id" element={<ScanInvoicePage />} />
                      <Route path="production" element={<ProductionPage />} />

                      <Route path="subscription" element={<SubscriptionManagementPage />} />
                      <Route path="history" element={<BillingHistoryPage />} />

                      {/* System Owner Routes - Only accessible to system owners */}
                      <Route path="system-owner/*" element={
                        <ProtectedSystemOwnerRoute>
                          <Suspense fallback={<Loading />}>
                            <SystemOwnerDashboard />
                          </Suspense>
                        </ProtectedSystemOwnerRoute>
                      } />
                    </Route>
                  </Routes>
                  <ToastProvider>
                    <ToastViewport />
                  </ToastProvider>
                </Suspense>
              </BrowserRouter>
            </SubscriptionProvider>
          </BranchProvider>
          </OrganizationSettingsProvider>
        </OrganizationProvider>
      </AuthProvider>
    </ThemeProvider>
      </TooltipProvider>
  );
}

export default App;
