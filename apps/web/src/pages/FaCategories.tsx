import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { DEP_METHOD_LABELS } from "../lib/fa";
import { useResource } from "../lib/session";
import type { FaCategory } from "../lib/types";

export function FaCategories() {
  const categories = useResource<FaCategory[]>("/api/v1/fixed-assets/categories?all=1");

  return (
    <>
      <PageHeader
        title="Asset categories"
        description="Default useful life, residual percent and depreciation method for each category. Edit rates on the company books — no statutory table is invented."
      />
      <Loadable resource={categories}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No categories" body="Categories are seeded on first use." />
          ) : (
            <div className="panel">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Method</th>
                    <th className="num">Life (mo)</th>
                    <th className="num">Residual %</th>
                    <th className="num">Rate %</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{DEP_METHOD_LABELS[c.depreciationMethod]}</td>
                      <td className="num">{c.usefulLifeMonths}</td>
                      <td className="num">{c.residualPercent}</td>
                      <td className="num">{c.ratePercent ?? "—"}</td>
                      <td>{c.isActive ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
