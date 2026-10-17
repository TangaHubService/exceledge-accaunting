import { Printer } from "lucide-react";
import { useMemo } from "react";
import { addDimensionParams, DimensionFilters } from "../components/DimensionFilters";
import { ExportButtons } from "../components/ExportButtons";
import { useFeedback } from "../components/feedback";
import { Pagination } from "../components/Pagination";
import { Select } from "../components/Select";
import { Badge, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, drCr, moduleLabel } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account, AccountLedger } from "../lib/types";
import { accountOptions, TYPE_LABELS } from "./Accounts";

export function Ledger() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency, reload: reloadCompany } = useCompany();
  const { query } = useLocation();
  const accountId = query.get("account");
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  const page = Math.max(1, Number(query.get("page")) || 1);
  const pageSize = Number(query.get("pageSize")) || 100;

  const accounts = useResource<Account[]>("/api/v1/coa");
  const range = new URLSearchParams();
  if (from) range.set("from", from);
  if (to) range.set("to", to);
  addDimensionParams(range, query);
  const exportPath = accountId ? `/api/v1/gl/accounts/${accountId}?${range}` : "";
  range.set("page", String(page));
  range.set("pageSize", String(pageSize));
  const ledger = useResource<AccountLedger>(accountId ? `/api/v1/gl/accounts/${accountId}?${range}` : null);

  const options = useMemo(() => accountOptions(accounts.data ?? []), [accounts.data]);
  const account = accounts.data?.find((a) => a.id === accountId);

  async function toggleActive(a: Account) {
    const deactivate = a.isActive;
    const ok = await confirm(
      deactivate
        ? { title: `Deactivate ${a.code} ${a.name}?`, body: "Nothing new can be posted to an inactive account. Its history and balance are kept.", confirmLabel: "Deactivate", danger: true }
        : { title: `Reactivate ${a.code} ${a.name}?`, confirmLabel: "Reactivate" },
    );
    if (!ok) return;
    try {
      await api(`/api/v1/coa/${a.id}/${deactivate ? "deactivate" : "reactivate"}`, { method: "POST", body: "{}" });
      toast(`${a.code} ${deactivate ? "deactivated" : "reactivated"}`);
      accounts.reload();
      reloadCompany();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title={account ? `${account.code} · ${account.name}` : "General ledger"}
        description={
          account ? (
            <>
              {TYPE_LABELS[account.type]}
              {!account.isActive && (
                <>
                  {" "}
                  · <Badge>Inactive</Badge>
                </>
              )}
              {account.systemProtected && " · System account"}
            </>
          ) : (
            "Every posting to an account, with its running balance."
          )
        }
        back={account ? { to: "/accounts", label: "Chart of accounts" } : undefined}
        actions={
          account && (
            <>
              <ExportButtons path={exportPath} filename={`ledger-${account.code}${to ? `-${to}` : ""}`} />
              <button type="button" className="btn" onClick={() => window.print()}>
                <Printer size={16} aria-hidden="true" />
                Print
              </button>
              {!account.systemProtected && (account.isActive ? can("coa:deactivate") : can("coa:edit")) && (
                <button type="button" className="btn" onClick={() => void toggleActive(account)}>
                  {account.isActive ? "Deactivate" : "Reactivate"}
                </button>
              )}
            </>
          )
        }
      />

      <div className="filter-bar no-print" style={{ alignItems: "flex-end" }}>
        <Field label="Account">
          <Select
            style={{ width: 320, maxWidth: "100%" }}
            value={accountId ?? ""}
            onChange={(v) => setQueryParam("account", v || null)}
            placeholder={accounts.data ? "Choose an account…" : "Loading accounts…"}
            options={options}
          />
        </Field>
        <Field label="From">
          <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setQueryParam("from", e.target.value || null)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setQueryParam("to", e.target.value || null)} />
        </Field>
        {(from || to) && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setQueryParam("from", null);
              setQueryParam("to", null);
            }}
          >
            All dates
          </button>
        )}
        <DimensionFilters query={query} />
      </div>

      {!accountId ? (
        <div className="panel">
          <EmptyState title="Choose an account" body="Pick an account above, or open one from the chart of accounts, to see every entry posted to it." />
        </div>
      ) : (
        <Loadable resource={ledger}>
          {(l) => {
            const broughtForward = l.pageOpeningBalance;
            return (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Date</th>
                      <th className="hide-sm" style={{ width: 150 }}>
                        Entry
                      </th>
                      <th>Description</th>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                      <th className="num">Balance ({currency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.entries.length > 0 && (from || Math.abs(broughtForward) > 0.005) && (
                      <tr>
                        <td className="muted">{page > 1 ? "" : from ? date(from) : ""}</td>
                        <td className="hide-sm" />
                        <td className="muted">{page > 1 ? "Balance from previous page" : "Opening balance"}</td>
                        <td />
                        <td />
                        <td className="num muted">{drCr(broughtForward)}</td>
                      </tr>
                    )}
                    {l.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap">{date(e.transactionDate)}</td>
                        <td className="hide-sm">
                          <Link to={`/journals?id=${e.journalId}`} className="mono">
                            {e.journalNumber}
                          </Link>
                        </td>
                        <td>
                          {e.description || <span className="muted">—</span>}
                          {(e.referenceNumber || e.sourceModule) && (
                            <span className="sub">{[moduleLabel(e.sourceModule), e.referenceNumber].filter(Boolean).join(" · ")}</span>
                          )}
                        </td>
                        <td className="num">{e.debit ? amount(e.debit) : ""}</td>
                        <td className="num">{e.credit ? amount(e.credit) : ""}</td>
                        <td className="num">{drCr(e.runningBalance)}</td>
                      </tr>
                    ))}
                    {l.entries.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <EmptyState
                            title={from || to ? "No entries in this date range" : "Nothing posted to this account yet"}
                            body={`Current balance: ${drCr(l.account.currentBalance)}`}
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {l.entries.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="hide-sm" />
                        <td>{from || to ? "Totals for the period and closing balance" : "Totals and closing balance"}</td>
                        <td className="num">{amount(l.totals.debit)}</td>
                        <td className="num">{amount(l.totals.credit)}</td>
                        <td className="num">{drCr(l.closingBalance)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                <Pagination
                  page={l.page}
                  pageSize={l.pageSize}
                  total={l.total}
                  onPage={(p) => setQueryParam("page", p > 1 ? String(p) : null)}
                  onPageSize={(n) => {
                    setQueryParam("page", null);
                    setQueryParam("pageSize", String(n));
                  }}
                />
              </div>
            );
          }}
        </Loadable>
      )}
    </>
  );
}
