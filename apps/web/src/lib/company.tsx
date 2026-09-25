import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useResource, useSession } from "./session";
import type { Account, SetupDashboard, SetupSnapshot } from "./types";

type Company = {
  loading: boolean;
  error?: string;
  name: string;
  tin: string | null;
  currency: string;
  dashboard?: SetupDashboard;
  snapshot?: SetupSnapshot;
  activated: boolean;
  accounts: Account[];
  /** Accounts that hold cash: flagged as cash, or mapped as a default cash/bank/mobile money account. */
  cashAccounts: Account[];
  reload: () => void;
};

const CompanyContext = createContext<Company | null>(null);

export function useCompany() {
  const c = useContext(CompanyContext);
  if (!c) throw new Error("useCompany outside CompanyProvider");
  return c;
}

const CASH_DEFAULT_KEYS = ["defaultCashAccountId", "defaultBankAccountId", "pettyCashAccountId", "mobileMoneyClearingId"];

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { can } = useSession();
  const allowed = can("setup:view");
  const dashboard = useResource<SetupDashboard>(allowed ? "/api/v1/setup/dashboard" : null);
  const snapshot = useResource<SetupSnapshot>(allowed ? "/api/v1/setup/snapshot" : null);

  const value = useMemo<Company>(() => {
    const snap = snapshot.data;
    const accounts = snap?.accounts ?? [];
    const cashIds = new Set(CASH_DEFAULT_KEYS.map((k) => snap?.defaults?.[k]).filter(Boolean) as string[]);
    return {
      loading: dashboard.loading || snapshot.loading,
      error: dashboard.error ?? snapshot.error,
      name: snap ? snap.profile?.tradingName || snap.profile?.registeredName || "Your company" : "",
      tin: snap?.profile?.taxIdentificationNumber ?? null,
      currency: dashboard.data?.functionalCurrency || "RWF",
      dashboard: dashboard.data,
      snapshot: snap,
      activated: dashboard.data?.activationStatus === "ACTIVATED",
      accounts,
      cashAccounts: accounts.filter((a) => a.isCashAccount || cashIds.has(a.id)),
      reload: () => {
        dashboard.reload();
        snapshot.reload();
      },
    };
  }, [dashboard, snapshot]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}
