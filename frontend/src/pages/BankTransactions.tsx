import { useEffect, useState } from "react";
import { TransactionDrawer } from "../components/BankingForms";
import { type Column, DataTable } from "../components/DataTable";
import { Select } from "../components/Select";
import { Badge, EmptyState, Field, Loadable, PageHeader, Pagination } from "../components/ui";
import { PAGE_SIZE_OPTIONS } from "../lib/pagination";
import { financialAccountOptions, txnEffect, txnLabel, useFinancialAccounts } from "../lib/banking";
import { useCompany } from "../lib/company";
import { amount, date } from "../lib/format";
import { setQueryParam, useLocation } from "../lib/router";
import { useResource } from "../lib/session";
import type { BankTransaction, BankTransactionKind, BankTransactionPage } from "../lib/types";
import { BankingActions, type BankingForm, BankingFormHost } from "./Banking";

const PAGE_SIZE = 50;

const GROUPS: Array<{ key: string; label: string; kinds: BankTransactionKind[] }> = [
  { key: "in", label: "Money in", kinds: ["RECEIPT", "INTEREST"] },
  { key: "out", label: "Money out", kinds: ["PAYMENT", "BANK_CHARGE"] },
  { key: "transfers", label: "Transfers", kinds: ["TRANSFER"] },
  { key: "counts", label: "Cash counts", kinds: ["CASH_COUNT"] },
];

export function BankTransactions() {
  const { currency } = useCompany();
  const { query } = useLocation();
  const show = query.get("show") ?? "all";
  const accountId = query.get("accountId") ?? "";
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  const page = Number(query.get("page") ?? 1) || 1;
  const urlPageSize = Number(query.get("pageSize") ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(urlPageSize) ? urlPageSize : PAGE_SIZE;
  const [search, setSearch] = useState(query.get("q") ?? "");
  const [open, setOpen] = useState<BankingForm>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const accounts = useFinancialAccounts(true);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((query.get("q") ?? "") !== search.trim()) {
        setQueryParam("page", null);
        setQueryParam("q", search.trim() || null);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, query]);

  const group = GROUPS.find((g) => g.key === show);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (group) params.set("kind", group.kinds.join(","));
  for (const [k, v] of Object.entries({ accountId, from, to, q: query.get("q") ?? "" })) if (v) params.set(k, v);
  const txns = useResource<BankTransactionPage>(`/api/v1/banking/transactions?${params}`);

  const filter = (key: string, value: string | null) => {
    setQueryParam("page", null);
    setQueryParam(key, value);
  };

  const columns: Column<BankTransaction>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (t) => date(t.transactionDate) },
    {
      key: "what",
      header: "Transaction",
      render: (t) => (
        <>
          <span className={t.status === "REVERSED" ? "strike" : undefined}>{t.description || txnLabel(t)}</span>
          <span className="sub">{[t.number, txnLabel(t), t.partyName, t.reference, t.chequeNumber && `Cheque ${t.chequeNumber}`].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    {
      key: "account",
      header: "Account",
      className: "hide-sm",
      render: (t) => (
        <>
          {t.financialAccountName}
          {t.counterAccountName && <span className="sub">to {t.counterAccountName}</span>}
        </>
      ),
    },
    {
      key: "amount",
      header: `Amount (${currency})`,
      numeric: true,
      render: (t) => {
        const effect = txnEffect(t, accountId || undefined);
        return <span className={effect > 0 ? "text-positive" : undefined}>{t.kind === "TRANSFER" && !accountId ? amount(t.amount) : amount(effect)}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      className: "hide-md",
      render: (t) => (t.status === "REVERSED" ? <Badge tone="warning">Reversed</Badge> : <span className="muted">{t.journalNumber ?? "Nothing posted"}</span>),
    },
  ];

  const filters: Array<[string, string]> = [["all", "All"], ...GROUPS.map((g) => [g.key, g.label] as [string, string])];
  const total = txns.data?.total ?? 0;

  const goToPage = (next: number) => setQueryParam("page", next <= 1 ? null : String(next));
  const changePageSize = (next: number) => {
    setQueryParam("pageSize", String(next));
    setQueryParam("page", null);
  };

  return (
    <>
      <PageHeader title="Bank transactions" description="Receipts, payments, transfers and cash counts recorded in Banking." actions={<BankingActions onOpen={setOpen} />} />
      <BankingFormHost open={open} onClose={() => setOpen(null)} onSaved={txns.reload} />
      {txnId && <TransactionDrawer id={txnId} onClose={() => setTxnId(null)} onChanged={txns.reload} />}

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search number, reference, cheque or party" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search transactions" />
        <div className="segmented" role="group" aria-label="Transaction type">
          {filters.map(([key, label]) => (
            <button key={key} type="button" className={show === key ? "on" : ""} onClick={() => filter("show", key === "all" ? null : key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-bar">
        <Field label="Account">
          <Select value={accountId} onChange={(v) => filter("accountId", v || null)} options={[{ value: "", label: "All accounts" }, ...financialAccountOptions(accounts.data ?? [])]} style={{ width: 220 }} />
        </Field>
        <Field label="From">
          <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => filter("from", e.target.value || null)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => filter("to", e.target.value || null)} />
        </Field>
      </div>

      <Loadable resource={txns}>
        {(p) => (
          <>
            <DataTable
              columns={columns}
              rows={p.rows}
              rowKey={(t) => t.id}
              onRowClick={(t) => setTxnId(t.id)}
              pageSize={pageSize}
              showPagination={false}
              empty={
                total === 0 && show === "all" && !accountId && !from && !to && !query.get("q") ? (
                  <EmptyState title="No bank transactions yet" body="Money received, payments, transfers and cash counts recorded here appear in this list." />
                ) : (
                  <EmptyState title="No transactions match" body="Try a different search, account, date range or type." />
                )
              }
            />
            {p.rows.length > 0 && (
              <dl className="report-summary">
                <div>
                  <dt>Received</dt>
                  <dd>{amount(p.totals.received)}</dd>
                </div>
                <div>
                  <dt>Paid</dt>
                  <dd>{amount(p.totals.paid)}</dd>
                </div>
                <div>
                  <dt>Transferred</dt>
                  <dd>{amount(p.totals.transferred)}</dd>
                </div>
                <div>
                  <dt>Reversed items</dt>
                  <dd className="muted">not counted</dd>
                </div>
              </dl>
            )}
            <Pagination page={page} pageSize={pageSize} total={total} onPage={goToPage} onPageSize={changePageSize} />
          </>
        )}
      </Loadable>
    </>
  );
}
