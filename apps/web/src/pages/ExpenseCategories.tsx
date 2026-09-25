import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { useResource, useSession } from "../lib/session";
import type { ExpenseCategory } from "../lib/types";

export function ExpenseCategories() {
  const { can } = useSession();
  const categories = useResource<ExpenseCategory[]>("/api/v1/expenses/categories?all=1");

  return (
    <>
      <PageHeader
        title="Expense categories"
        description="Each category maps to a GL expense account. Seeded defaults can be edited by your accountant."
        back={{ to: "/expenses", label: "Expenses" }}
      />
      <Loadable resource={categories}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No categories" body="Categories are created the first time Expenses is opened." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>GL account</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={c.isActive ? undefined : "row-inactive"}>
                      <td>
                        <strong>{c.code}</strong>
                      </td>
                      <td>{c.name}</td>
                      <td>
                        {c.glAccountCode ? (
                          <>
                            {c.glAccountCode}
                            <span className="sub">{c.glAccountName}</span>
                          </>
                        ) : (
                          <span className="muted">Not mapped</span>
                        )}
                      </td>
                      <td>{c.isActive ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {can("expense:manage") && <p className="muted small">Map or rename categories from the API for now; a full editor ships with company setup polish.</p>}
            </div>
          )
        }
      </Loadable>
    </>
  );
}
