/** Dummy data and nav for TEAM hub screens (matches design mocks). */

export const TEAM_HUB_ITEMS = [
  { id: "overview", label: "Overview", to: "/employees" },
  { id: "employees", label: "Employees", to: "/employees" },
  { id: "time-tracking", label: "Time tracking", to: "/time/weekly" },
  { id: "payroll", label: "Payroll", to: "/employees" },
] as const;

export const EMPLOYEE_HERO = {
  title: "Build your team in one place",
  subtitle: "Add employee details, organise your workforce, and get ready for payroll.",
  bullets: [
    "Keep employee records organised",
    "Manage working hours and attendance",
    "Prepare accurate payroll",
  ],
  tips: [
    { label: "How to add an employee", href: "#" },
    { label: "Download the employee import template", href: "#" },
  ],
} as const;

export const EMPLOYEE_STEPS = [
  { id: "personal", label: "Personal details", nextLabel: "Next: Employment" },
  { id: "employment", label: "Employment", nextLabel: "Next: Payroll" },
  { id: "payroll", label: "Payroll", nextLabel: "Next: Documents" },
  { id: "documents", label: "Documents", nextLabel: "Save employee" },
] as const;

export type EmployeeStepId = (typeof EMPLOYEE_STEPS)[number]["id"];

export const GENDER_OPTIONS = [
  { value: "", label: "Select gender" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not", label: "Prefer not to say" },
] as const;

export const COUNTRY_OPTIONS = [
  { value: "RW", label: "Rwanda" },
  { value: "KE", label: "Kenya" },
  { value: "UG", label: "Uganda" },
  { value: "TZ", label: "Tanzania" },
  { value: "other", label: "Other" },
] as const;

export const DEPARTMENT_OPTIONS = [
  { value: "", label: "Select department" },
  { value: "finance", label: "Finance" },
  { value: "operations", label: "Operations" },
  { value: "sales", label: "Sales" },
  { value: "hr", label: "Human resources" },
  { value: "it", label: "IT" },
  { value: "other", label: "Other" },
] as const;

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "", label: "Select type" },
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
] as const;

export const WORK_LOCATION_OPTIONS = [
  { value: "", label: "Select location" },
  { value: "kigali_hq", label: "Kigali HQ" },
  { value: "branch", label: "Branch office" },
  { value: "remote", label: "Remote" },
] as const;

export const MANAGER_OPTIONS = [
  { value: "", label: "Select manager" },
  { value: "none", label: "No manager" },
] as const;

export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "on_leave", label: "On leave" },
  { value: "terminated", label: "Terminated" },
] as const;

export const PROBATION_OPTIONS = [
  { value: "", label: "Select period" },
  { value: "none", label: "None" },
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
] as const;

export const WORK_SCHEDULE_OPTIONS = [
  { value: "", label: "Select schedule" },
  { value: "standard", label: "Standard (Mon–Fri)" },
  { value: "shift", label: "Shift work" },
  { value: "flexible", label: "Flexible" },
] as const;

export const PAY_FREQUENCY_OPTIONS = [
  { value: "", label: "Select frequency" },
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "weekly", label: "Weekly" },
] as const;

export const CURRENCY_OPTIONS = [
  { value: "RWF", label: "RWF" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
] as const;

export const PAY_METHOD_OPTIONS = [
  { value: "", label: "Select method" },
  { value: "bank", label: "Bank transfer" },
  { value: "mobile", label: "Mobile money" },
  { value: "cash", label: "Cash" },
] as const;

export const BANK_OPTIONS = [
  { value: "", label: "Select bank" },
  { value: "bk", label: "Bank of Kigali" },
  { value: "equity", label: "Equity Bank" },
  { value: "gtbank", label: "GTBank" },
  { value: "other", label: "Other" },
] as const;

export const TIME_NAME_OPTIONS = [
  { value: "", label: "Select name" },
  { value: "self", label: "Me" },
] as const;

export const TIME_CUSTOMER_OPTIONS = [
  { value: "", label: "Select customer" },
  { value: "internal", label: "Internal / Admin" },
] as const;

export const TIME_SERVICE_OPTIONS = [
  { value: "", label: "Select service" },
  { value: "consulting", label: "Consulting" },
  { value: "bookkeeping", label: "Bookkeeping" },
  { value: "advisory", label: "Advisory" },
] as const;

export type EmployeeDraft = {
  firstName: string;
  lastName: string;
  middleName: string;
  preferredName: string;
  dateOfBirth: string;
  gender: string;
  nationalId: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  employeeId: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  joiningDate: string;
  workLocation: string;
  reportingManager: string;
  employmentStatus: string;
  contractStart: string;
  contractEnd: string;
  probation: string;
  workSchedule: string;
  payFrequency: string;
  currency: string;
  basicSalary: string;
  effectiveFrom: string;
  paymentMethod: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  tin: string;
  rssb: string;
};

export type StoredEmployee = EmployeeDraft & {
  id: string;
  displayName: string;
  createdAt: string;
};

const STORAGE_KEY = "ee-team-employees";
const DRAFT_KEY = "ee-team-employee-draft";

export function emptyEmployeeDraft(): EmployeeDraft {
  return {
    firstName: "",
    lastName: "",
    middleName: "",
    preferredName: "",
    dateOfBirth: "",
    gender: "",
    nationalId: "",
    email: "",
    phone: "+250",
    address: "",
    city: "",
    country: "RW",
    employeeId: "Auto-generated",
    jobTitle: "",
    department: "",
    employmentType: "",
    joiningDate: "",
    workLocation: "",
    reportingManager: "",
    employmentStatus: "active",
    contractStart: "",
    contractEnd: "",
    probation: "",
    workSchedule: "",
    payFrequency: "",
    currency: "RWF",
    basicSalary: "",
    effectiveFrom: "",
    paymentMethod: "",
    bankName: "",
    accountHolder: "",
    accountNumber: "",
    tin: "",
    rssb: "",
  };
}

export function employeeDisplayName(d: EmployeeDraft) {
  return [d.firstName, d.lastName].filter(Boolean).join(" ").trim() || "Employee";
}

export function loadEmployees(): StoredEmployee[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredEmployee[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEmployees(list: StoredEmployee[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function loadEmployeeDraft(): EmployeeDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return { ...emptyEmployeeDraft(), ...(JSON.parse(raw) as EmployeeDraft) };
  } catch {
    return null;
  }
}

export function saveEmployeeDraft(draft: EmployeeDraft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearEmployeeDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

/** Sunday-start week label matching the weekly timesheet mock. */
export function weekRangeLabel(anchor = new Date(2026, 9, 18)) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmt(start)} – ${end.getDate()} ${end.toLocaleDateString("en-GB", { month: "short" })} ${end.getFullYear()}`;
}

export function weekDayHeaders(anchor = new Date(2026, 9, 18)) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names.map((name, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { key: name.toLowerCase(), label: `${name} ${d.getDate()}` };
  });
}
