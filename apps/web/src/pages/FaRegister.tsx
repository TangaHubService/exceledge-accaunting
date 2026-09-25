import { Plus } from "lucide-react";
import { useState } from "react";
import { RegisterAssetForm } from "../components/FaForms";
import { Badge, EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { ASSET_STATUS } from "../lib/fa";
import { amount, date } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { FixedAssetListItem } from "../lib/types";

export function FaRegister() {
  const { can } = useSession();
  const { currency } = useCompany();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useResource<FixedAssetListItem[]>(
    `/api/v1/fixed-assets/assets?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString()}`,
  );
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Asset register"
        description="Every capitalized and registered asset with cost, accumulated depreciation and net book value."
        actions={
          can("fa:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Register asset
            </button>
          )
        }
      />
      {open && (
        <RegisterAssetForm
          onClose={() => setOpen(false)}
          onSaved={(a) => {
            setOpen(false);
            navigate(`/fixed-assets/assets/${a.id}`);
          }}
        />
      )}

      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input className="input" placeholder="Search number, name, serial…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All statuses</option>
          {Object.entries(ASSET_STATUS).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>

      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No assets match" body="Adjust filters or register a new asset." />
          ) : (
            <div className="panel">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Category</th>
                    <th className="num">Cost</th>
                    <th className="num">Accum. dep.</th>
                    <th className="num">NBV</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/fixed-assets/assets/${a.id}`}>{a.number}</Link>
                        <span className="sub">
                          {a.name}
                          {a.location ? ` · ${a.location}` : ""}
                          {a.purchaseDate ? ` · ${date(a.purchaseDate)}` : ""}
                        </span>
                      </td>
                      <td>{a.categoryName}</td>
                      <td className="num">{amount(a.acquisitionCost)}</td>
                      <td className="num">{amount(a.accumulatedDepreciation)}</td>
                      <td className="num">{amount(a.netBookValue)}</td>
                      <td>
                        <Badge tone={ASSET_STATUS[a.status].tone}>{ASSET_STATUS[a.status].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ marginTop: 8 }}>
                Showing {rows.length} · {currency}
              </p>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
