import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { AddEmployeeDrawer } from "../components/team/AddEmployeeDrawer";
import { EmployeesHero } from "../components/team/EmployeesHero";
import { EmployeesTips } from "../components/team/EmployeesTips";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import {
  employeeFromServer,
  employeeToServer,
  type StoredEmployee,
} from "../lib/team-dummy";

export function Employees() {
  const { query } = useLocation();
  const { api, can } = useSession();
  const { toast } = useFeedback();
  const list = useResource<Array<Record<string, unknown>>>(can("team:view") ? "/api/v1/team/employees" : null);
  const employees = useMemo(() => (list.data ?? []).map(employeeFromServer), [list.data]);
  const [creating, setCreating] = useState(query.get("new") === "1");

  useEffect(() => {
    setCreating(query.get("new") === "1");
  }, [query]);

  const showHero = employees.length === 0;

  function openCreate() {
    setCreating(true);
    setQueryParam("new", "1");
  }

  function closeCreate() {
    setCreating(false);
    setQueryParam("new", null);
  }

  async function onSaved(employee: StoredEmployee) {
    await api(`/api/v1/team/employees/${encodeURIComponent(employee.id)}`, { method: "PUT", body: JSON.stringify(employeeToServer(employee)) });
    toast(`${employee.displayName} saved`);
    list.reload();
    closeCreate();
  }

  return (
    <div className="ee-team-page">
      <nav className="ee-cust-crumbs" aria-label="Breadcrumb">
        <span>Team</span>
        <span className="ee-cust-crumbs-sep">/</span>
        <span>Employees</span>
      </nav>

      <header className="ee-cust-page-head">
        <h1>Employees</h1>
        {!showHero && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" />
            Add employee
          </button>
        )}
      </header>

      {showHero ? (
        <>
          <EmployeesHero onAdd={openCreate} onImport={openCreate} />
          <EmployeesTips />
        </>
      ) : (
        <div className="ee-team-list panel">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Job title</th>
                <th>Department</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="strong">{e.displayName}</span>
                    {e.email ? <span className="sub">{e.email}</span> : null}
                  </td>
                  <td>{e.jobTitle || <span className="subtle">—</span>}</td>
                  <td>{e.department || <span className="subtle">—</span>}</td>
                  <td className="capitalize">{e.employmentStatus.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="table-caption">
            <button type="button" className="ee-link-btn" onClick={() => navigate("/time/single")}>
              Single time activity
            </button>
            {" · "}
            <button type="button" className="ee-link-btn" onClick={() => navigate("/time/weekly")}>
              Weekly timesheet
            </button>
          </p>
        </div>
      )}

      {creating && <AddEmployeeDrawer onClose={closeCreate} onSaved={onSaved} />}
    </div>
  );
}
