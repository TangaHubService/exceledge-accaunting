import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { AllAppsSidebar } from "../components/customers/AllAppsSidebar";
import { AddEmployeeDrawer } from "../components/team/AddEmployeeDrawer";
import { EmployeesHero } from "../components/team/EmployeesHero";
import { EmployeesTips } from "../components/team/EmployeesTips";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import {
  loadEmployees,
  saveEmployees,
  type StoredEmployee,
} from "../lib/team-dummy";

export function Employees() {
  const { query } = useLocation();
  const [employees, setEmployees] = useState<StoredEmployee[]>(() => loadEmployees());
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

  function onSaved(employee: StoredEmployee) {
    const next = [employee, ...employees];
    setEmployees(next);
    saveEmployees(next);
    closeCreate();
  }

  return (
    <div className="ee-hub-page">
      <AllAppsSidebar activeLeaf="employees" />
      <div className="ee-hub-main ee-team-page">
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
    </div>
  );
}
