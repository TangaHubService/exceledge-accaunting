function url(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

/** Main Excel Edge ERP web app: session handoff, password reset and the way back from Accounting. */
export const ERP_URL = url(import.meta.env.VITE_ERP_URL, "http://localhost:5173");

/** Excel Edge ERP API, used for email sign-in. */
export const ERP_API_URL = url(import.meta.env.VITE_ERP_API_URL, `${ERP_URL}/api`);

/**
 * Accounting API base. Empty = same origin as the web app (relative `/api/...`
 * calls, e.g. behind an nginx reverse proxy on https://api.exceledgecpa.com).
 * Set to an absolute URL only when the API lives on a different origin.
 */
export const ACCOUNTING_API_URL = (import.meta.env.VITE_ACCOUNTING_API_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? "";

/** Prefix a `/api/...` or `/health` path with the accounting API base when configured. */
export function accountingUrl(path: string) {
  if (!ACCOUNTING_API_URL || /^https?:\/\//i.test(path)) return path;
  return `${ACCOUNTING_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const erpLinks = {
  home: ERP_URL,
  forgotPassword: `${ERP_URL}/forgot-password`,
  handoff: (returnTo: string) => `${ERP_URL}/accounting-handoff?return=${encodeURIComponent(returnTo)}`,
  login: `${ERP_API_URL}/auth/login`,
};
