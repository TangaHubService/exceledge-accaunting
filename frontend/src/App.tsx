import type { AccountingCapability } from "@exceledge/accounting-domain";
import { type ReactNode, useCallback, useState } from "react";
import { FeedbackProvider } from "./components/feedback";
import { Shell } from "./components/Shell";
import { erpLinks } from "./lib/config";
import { EmptyState } from "./components/ui";
import { CompanyProvider } from "./lib/company";
import { Link, match, Redirect, useLocation } from "./lib/router";
import { clearToken, readInitialToken, SessionProvider, storeToken, useSession } from "./lib/session";
import { Accounts } from "./pages/Accounts";
import { AgeingReportPage } from "./pages/Ageing";
import { Approvals } from "./pages/Approvals";
import { Assurance } from "./pages/Assurance";
import { AuditLog } from "./pages/AuditLog";
import { BankAccount } from "./pages/BankAccount";
import { Banking } from "./pages/Banking";
import { BankReconciliationDetail, BankReconciliations } from "./pages/BankReconciliations";
import { BankTransactions } from "./pages/BankTransactions";
import { Bills } from "./pages/Bills";
import { Controls, Currencies, PeriodClose, Platform, Statements } from "./pages/Books";
import { Budgets } from "./pages/Budgets";
import { CashPosition } from "./pages/CashPosition";
import { CustomerDetail } from "./pages/CustomerDetail";
import { Customers } from "./pages/Customers";
import { Employees } from "./pages/Employees";
import { Dimensions } from "./pages/Dimensions";
import { SingleTimeActivity } from "./components/team/SingleTimeActivity";
import { WeeklyTimesheet } from "./components/team/WeeklyTimesheet";
import { Exceptions } from "./pages/Exceptions";
import { ExpenseCategories } from "./pages/ExpenseCategories";
import { Expenses } from "./pages/Expenses";
import { ExpensesList } from "./pages/ExpensesList";
import { ExpensesRecurring } from "./pages/ExpensesRecurring";
import { ExpensesReport } from "./pages/ExpensesReport";
import { FaAssetDetail } from "./pages/FaAssetDetail";
import { FaCategories } from "./pages/FaCategories";
import { FaDepreciation } from "./pages/FaDepreciation";
import { FaRegister } from "./pages/FaRegister";
import { FixedAssets } from "./pages/FixedAssets";
import { Inventory } from "./pages/Inventory";
import { InventoryMovements } from "./pages/InventoryMovements";
import { InventoryReconciliation } from "./pages/InventoryReconciliation";
import { CostOfSalesReport, InventoryValuationReport, SlowMovingReport } from "./pages/InventoryReports";
import { ImportSuppliers } from "./pages/ImportSuppliers";
import { Invoices } from "./pages/Invoices";
import { JournalNew } from "./pages/JournalNew";
import { Journals } from "./pages/Journals";
import { JournalImport, RecurringJournals } from "./pages/JournalTools";
import { Ledger } from "./pages/Ledger";
import { Notifications } from "./pages/Notifications";
import { Overview } from "./pages/Overview";
import { PurchasesBySupplierReport } from "./pages/PurchasesBySupplier";
import { Branches } from "./pages/Branches";
import { Setup } from "./pages/Setup";
import { SupplierDetail } from "./pages/SupplierDetail";
import { SupplierPayments } from "./pages/SupplierPayments";
import { Suppliers } from "./pages/Suppliers";
import { Tax } from "./pages/Tax";
import { TaxFilings } from "./pages/TaxFilings";
import { TaxFiscal } from "./pages/TaxFiscal";
import { TaxLedgerPage } from "./pages/TaxLedger";
import { TaxPayments } from "./pages/TaxPayments";
import { TaxReconciliationPage } from "./pages/TaxReconciliation";
import { TaxSettingsPage } from "./pages/TaxSettings";
import { TaxVat } from "./pages/TaxVat";
import { TrialBalance } from "./pages/TrialBalance";
import { WithholdingTaxReport } from "./pages/WithholdingTax";
import { Workflows } from "./pages/Workflows";
import { SignIn } from "./SignIn";
import { AddUser } from "./pages/AddUser";
import { CustomFormStyles } from "./pages/CustomFormStyles";
import { EditInvoiceStyle } from "./pages/EditInvoiceStyle";
import { InviteFirm } from "./pages/InviteFirm";
import { ManageUsers } from "./pages/ManageUsers";
import { AdvancedSettings } from "./pages/settings/AdvancedSettings";
import { CompanySettings } from "./pages/settings/CompanySettings";
import { ExpensesSettings } from "./pages/settings/ExpensesSettings";
import { InboxSettings } from "./pages/settings/InboxSettings";
import { ReportsSettings } from "./pages/settings/ReportsSettings";
import { SalesSettings } from "./pages/settings/SalesSettings";
import { TimeSettings } from "./pages/settings/TimeSettings";
import { UsageSettings } from "./pages/settings/UsageSettings";
import { WalletSettings } from "./pages/settings/WalletSettings";

type Route = { pattern: string; needs: AccountingCapability; render: (params: Record<string, string>) => ReactNode };

const ROUTES: Route[] = [
  { pattern: "/", needs: "setup:view", render: () => <Overview /> },
  { pattern: "/workflows", needs: "setup:view", render: () => <Workflows /> },
  { pattern: "/settings/company", needs: "setup:view", render: () => <CompanySettings /> },
  { pattern: "/settings/usage", needs: "setup:view", render: () => <UsageSettings /> },
  { pattern: "/settings/reports", needs: "setup:view", render: () => <ReportsSettings /> },
  { pattern: "/settings/sales", needs: "setup:view", render: () => <SalesSettings /> },
  { pattern: "/settings/expenses", needs: "setup:view", render: () => <ExpensesSettings /> },
  { pattern: "/settings/time", needs: "setup:view", render: () => <TimeSettings /> },
  { pattern: "/settings/inbox", needs: "setup:view", render: () => <InboxSettings /> },
  { pattern: "/settings/wallet", needs: "setup:view", render: () => <WalletSettings /> },
  { pattern: "/settings/advanced", needs: "setup:view", render: () => <AdvancedSettings /> },
  { pattern: "/settings/form-styles/edit", needs: "setup:view", render: () => <EditInvoiceStyle /> },
  { pattern: "/settings/form-styles", needs: "setup:view", render: () => <CustomFormStyles /> },
  { pattern: "/settings", needs: "setup:view", render: () => <CompanySettings /> },
  { pattern: "/users/new", needs: "setup:view", render: () => <AddUser /> },
  { pattern: "/users/accounting-firms/invite", needs: "setup:view", render: () => <InviteFirm /> },
  { pattern: "/users/accounting-firms", needs: "setup:view", render: () => <ManageUsers /> },
  { pattern: "/users/roles", needs: "setup:view", render: () => <ManageUsers /> },
  { pattern: "/users", needs: "setup:view", render: () => <ManageUsers /> },
  { pattern: "/customers", needs: "ar:view", render: () => <Customers /> },
  { pattern: "/customers/:id", needs: "ar:view", render: (p) => <CustomerDetail id={p.id} /> },
  { pattern: "/employees", needs: "setup:view", render: () => <Employees /> },
  { pattern: "/time/single", needs: "setup:view", render: () => <SingleTimeActivity /> },
  { pattern: "/time/weekly", needs: "setup:view", render: () => <WeeklyTimesheet /> },
  { pattern: "/invoices", needs: "ar:view", render: () => <Invoices /> },
  { pattern: "/suppliers/import", needs: "ap:manage", render: () => <ImportSuppliers /> },
  { pattern: "/suppliers", needs: "ap:view", render: () => <Suppliers /> },
  { pattern: "/suppliers/:id", needs: "ap:view", render: (p) => <SupplierDetail id={p.id} /> },
  { pattern: "/bills", needs: "ap:view", render: () => <Bills /> },
  { pattern: "/supplier-payments", needs: "ap:view", render: () => <SupplierPayments /> },
  { pattern: "/inventory", needs: "inventory:view", render: () => <Inventory /> },
  { pattern: "/inventory/movements", needs: "inventory:view", render: () => <InventoryMovements /> },
  { pattern: "/inventory/reconciliation", needs: "inventory:view", render: () => <InventoryReconciliation /> },
  { pattern: "/banking", needs: "bank:view", render: () => <Banking /> },
  { pattern: "/banking/accounts/:id", needs: "bank:view", render: (p) => <BankAccount key={p.id} id={p.id} /> },
  { pattern: "/banking/transactions", needs: "bank:view", render: () => <BankTransactions /> },
  { pattern: "/banking/integration-transactions", needs: "bank:view", render: () => <BankTransactions /> },
  { pattern: "/banking/rules", needs: "bank:view", render: () => <Banking /> },
  { pattern: "/banking/reconciliation", needs: "bank:view", render: () => <BankReconciliations /> },
  { pattern: "/banking/reconciliation/:id", needs: "bank:view", render: (p) => <BankReconciliationDetail key={p.id} id={p.id} /> },
  { pattern: "/tax", needs: "tax:view", render: () => <Tax /> },
  { pattern: "/tax/vat", needs: "tax:view", render: () => <TaxVat /> },
  { pattern: "/tax/ledger", needs: "tax:view", render: () => <TaxLedgerPage /> },
  { pattern: "/tax/payments", needs: "tax:view", render: () => <TaxPayments /> },
  { pattern: "/tax/filings", needs: "tax:view", render: () => <TaxFilings /> },
  { pattern: "/tax/settings", needs: "tax:view", render: () => <TaxSettingsPage /> },
  { pattern: "/tax/reconciliation", needs: "tax:view", render: () => <TaxReconciliationPage /> },
  { pattern: "/tax/fiscal", needs: "tax:view", render: () => <TaxFiscal /> },
  { pattern: "/expenses", needs: "expense:view", render: () => <Expenses /> },
  { pattern: "/expenses/list", needs: "expense:view", render: () => <ExpensesList /> },
  { pattern: "/expenses/recurring", needs: "expense:view", render: () => <ExpensesRecurring /> },
  { pattern: "/expenses/categories", needs: "expense:view", render: () => <ExpenseCategories /> },
  { pattern: "/expenses/report", needs: "expense:view", render: () => <ExpensesReport /> },
  { pattern: "/fixed-assets", needs: "fa:view", render: () => <FixedAssets /> },
  { pattern: "/fixed-assets/register", needs: "fa:view", render: () => <FaRegister /> },
  { pattern: "/fixed-assets/depreciation", needs: "fa:view", render: () => <FaDepreciation /> },
  { pattern: "/fixed-assets/categories", needs: "fa:view", render: () => <FaCategories /> },
  { pattern: "/fixed-assets/assets/:id", needs: "fa:view", render: (p) => <FaAssetDetail key={p.id} id={p.id} /> },
  { pattern: "/journals", needs: "journal:view", render: () => <Journals /> },
  { pattern: "/journals/new", needs: "journal:create", render: () => <JournalNew /> },
  { pattern: "/journals/:id/edit", needs: "journal:create", render: (p) => <JournalNew key={p.id} id={p.id} /> },
  { pattern: "/accounting/revenue-recognition", needs: "journal:view", render: () => <Journals /> },
  { pattern: "/approvals", needs: "journal:view", render: () => <Approvals /> },
  { pattern: "/notifications", needs: "setup:view", render: () => <Notifications /> },
  { pattern: "/ledger", needs: "gl:view", render: () => <Ledger /> },
  { pattern: "/accounting/chart-of-accounts", needs: "coa:view", render: () => <Accounts /> },
  { pattern: "/accounts", needs: "coa:view", render: () => <Redirect to="/accounting/chart-of-accounts" /> },
  { pattern: "/accounting/recurring-transactions", needs: "journal:view", render: () => <RecurringJournals /> },
  { pattern: "/recurring-journals", needs: "journal:view", render: () => <Redirect to="/accounting/recurring-transactions" /> },
  { pattern: "/accounting/prepaid-expenses", needs: "expense:view", render: () => <Expenses /> },
  { pattern: "/accounting/my-accountant", needs: "setup:view", render: () => <Setup /> },
  { pattern: "/journal-import", needs: "journal:create", render: () => <JournalImport /> },
  { pattern: "/reports/trial-balance", needs: "report:view", render: () => <TrialBalance /> },
  { pattern: "/dimensions", needs: "report:view", render: () => <Dimensions /> },
  { pattern: "/reports/statements", needs: "report:view", render: () => <Statements /> },
  { pattern: "/close", needs: "close:view", render: () => <PeriodClose /> },
  { pattern: "/budgets", needs: "budget:view", render: () => <Budgets /> },
  { pattern: "/currencies", needs: "report:view", render: () => <Currencies /> },
  { pattern: "/controls", needs: "control:view", render: () => <Controls /> },
  { pattern: "/platform", needs: "platform:view", render: () => <Platform /> },
  { pattern: "/assurance", needs: "platform:view", render: () => <Assurance /> },
  { pattern: "/reports/ageing", needs: "ar:view", render: () => <AgeingReportPage kind="ar" /> },
  { pattern: "/reports/payables-ageing", needs: "ap:view", render: () => <AgeingReportPage kind="ap" /> },
  { pattern: "/reports/withholding-tax", needs: "ap:view", render: () => <WithholdingTaxReport /> },
  { pattern: "/reports/purchases-by-supplier", needs: "ap:view", render: () => <PurchasesBySupplierReport /> },
  { pattern: "/reports/inventory-valuation", needs: "inventory:view", render: () => <InventoryValuationReport /> },
  { pattern: "/reports/cost-of-sales", needs: "inventory:view", render: () => <CostOfSalesReport /> },
  { pattern: "/reports/slow-moving", needs: "inventory:view", render: () => <SlowMovingReport /> },
  { pattern: "/reports/cash-position", needs: "bank:view", render: () => <CashPosition /> },
  { pattern: "/setup", needs: "setup:view", render: () => <Setup /> },
  { pattern: "/branches", needs: "setup:view", render: () => <Branches /> },
  { pattern: "/exceptions", needs: "exceptions:view", render: () => <Exceptions /> },
  { pattern: "/audit", needs: "audit:view", render: () => <AuditLog /> },
];

export function App() {
  const [token, setToken] = useState(readInitialToken);
  const [notice, setNotice] = useState("");

  const signOut = useCallback((reason?: "expired") => {
    clearToken();
    setToken("");
    setNotice(reason === "expired" ? "Your session ended. Sign in again to continue." : "");
  }, []);

  function signIn(next: string, remember = true, refreshToken?: string) {
    storeToken(next, remember, refreshToken);
    setNotice("");
    setToken(next);
  }

  if (!token) return <SignIn onSignedIn={signIn} notice={notice} />;

  return (
    <SessionProvider token={token} onSignOut={signOut} onTokenRefreshed={setToken}>
      <FeedbackProvider>
        <Gate />
      </FeedbackProvider>
    </SessionProvider>
  );
}

function Gate() {
  const { can, signOut } = useSession();
  if (!can("setup:view") && !can("ar:view") && !can("ap:view") && !can("inventory:view") && !can("bank:view") && !can("tax:view") && !can("expense:view") && !can("fa:view") && !can("journal:view") && !can("report:view")) {
    return (
      <div className="center-screen">
        <div className="panel" style={{ maxWidth: 440 }}>
          <EmptyState
            title="Accounting isn't available for your role"
            body="Your Excel Edge role doesn't include access to the accounting books. Ask an administrator or accountant if you need access."
            action={
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <a className="btn btn-primary" href={erpLinks.home}>
                  Back to Excel Edge
                </a>
                <button type="button" className="btn" onClick={signOut}>
                  Sign out
                </button>
              </div>
            }
          />
        </div>
      </div>
    );
  }
  return (
    <CompanyProvider>
      <RoutedShell />
    </CompanyProvider>
  );
}

function RoutedShell() {
  const { path } = useLocation();
  const page = <Routes />;
  // Full-page chrome (not the main app Shell).
  if (path.startsWith("/settings/form-styles/edit")) return page;
  if (path.startsWith("/settings") && !path.startsWith("/settings/form-styles")) return page;
  if (path.startsWith("/suppliers/import")) return page;
  if (path.startsWith("/time/")) return page;
  return <Shell>{page}</Shell>;
}

function Routes() {
  const { path } = useLocation();
  const { can } = useSession();
  for (const route of ROUTES) {
    const params = match(route.pattern, path);
    if (!params) continue;
    if (!can(route.needs)) {
      return (
        <div className="panel">
          <EmptyState title="You don't have access to this page" body="Your role doesn't include this part of Accounting." />
        </div>
      );
    }
    return <>{route.render(params)}</>;
  }
  return (
    <div className="panel">
      <EmptyState title="Page not found" body="The page you're looking for doesn't exist." action={<Link to="/" className="btn">Go to overview</Link>} />
    </div>
  );
}
