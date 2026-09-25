import type { AccountingCapability } from "@exceledge/accounting-domain";
import { type ReactNode, useCallback, useState } from "react";
import { FeedbackProvider } from "./components/feedback";
import { Shell } from "./components/Shell";
import { erpLinks } from "./lib/config";
import { EmptyState } from "./components/ui";
import { CompanyProvider } from "./lib/company";
import { Link, match, useLocation } from "./lib/router";
import { clearToken, readInitialToken, SessionProvider, storeToken, useSession } from "./lib/session";
import { Accounts } from "./pages/Accounts";
import { AgeingReportPage } from "./pages/Ageing";
import { AuditLog } from "./pages/AuditLog";
import { BankAccount } from "./pages/BankAccount";
import { Banking } from "./pages/Banking";
import { BankReconciliationDetail, BankReconciliations } from "./pages/BankReconciliations";
import { BankTransactions } from "./pages/BankTransactions";
import { Bills } from "./pages/Bills";
import { CashPosition } from "./pages/CashPosition";
import { CustomerDetail } from "./pages/CustomerDetail";
import { Customers } from "./pages/Customers";
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
import { Invoices } from "./pages/Invoices";
import { JournalNew } from "./pages/JournalNew";
import { Journals } from "./pages/Journals";
import { Ledger } from "./pages/Ledger";
import { Overview } from "./pages/Overview";
import { PurchasesBySupplierReport } from "./pages/PurchasesBySupplier";
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
import { SignIn } from "./SignIn";

type Route = { pattern: string; needs: AccountingCapability; render: (params: Record<string, string>) => ReactNode };

const ROUTES: Route[] = [
  { pattern: "/", needs: "setup:view", render: () => <Overview /> },
  { pattern: "/customers", needs: "ar:view", render: () => <Customers /> },
  { pattern: "/customers/:id", needs: "ar:view", render: (p) => <CustomerDetail id={p.id} /> },
  { pattern: "/invoices", needs: "ar:view", render: () => <Invoices /> },
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
  { pattern: "/ledger", needs: "gl:view", render: () => <Ledger /> },
  { pattern: "/accounts", needs: "coa:view", render: () => <Accounts /> },
  { pattern: "/reports/trial-balance", needs: "coa:view", render: () => <TrialBalance /> },
  { pattern: "/reports/ageing", needs: "ar:view", render: () => <AgeingReportPage kind="ar" /> },
  { pattern: "/reports/payables-ageing", needs: "ap:view", render: () => <AgeingReportPage kind="ap" /> },
  { pattern: "/reports/withholding-tax", needs: "ap:view", render: () => <WithholdingTaxReport /> },
  { pattern: "/reports/purchases-by-supplier", needs: "ap:view", render: () => <PurchasesBySupplierReport /> },
  { pattern: "/reports/inventory-valuation", needs: "inventory:view", render: () => <InventoryValuationReport /> },
  { pattern: "/reports/cost-of-sales", needs: "inventory:view", render: () => <CostOfSalesReport /> },
  { pattern: "/reports/slow-moving", needs: "inventory:view", render: () => <SlowMovingReport /> },
  { pattern: "/reports/cash-position", needs: "bank:view", render: () => <CashPosition /> },
  { pattern: "/setup", needs: "setup:view", render: () => <Setup /> },
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

  function signIn(next: string) {
    storeToken(next);
    setNotice("");
    setToken(next);
  }

  if (!token) return <SignIn onSignedIn={signIn} notice={notice} />;

  return (
    <SessionProvider token={token} onSignOut={signOut}>
      <FeedbackProvider>
        <Gate />
      </FeedbackProvider>
    </SessionProvider>
  );
}

function Gate() {
  const { can, signOut } = useSession();
  if (!can("setup:view") && !can("ar:view") && !can("ap:view") && !can("inventory:view") && !can("bank:view") && !can("tax:view") && !can("expense:view") && !can("fa:view") && !can("journal:view")) {
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
      <Shell>
        <Routes />
      </Shell>
    </CompanyProvider>
  );
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
