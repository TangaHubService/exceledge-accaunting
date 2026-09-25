function url(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

/** Main Excel Edge ERP web app: session handoff, password reset and the way back from Accounting. */
export const ERP_URL = url(import.meta.env.VITE_ERP_URL, "http://localhost:5173");

/** Excel Edge ERP API, used for email sign-in. */
export const ERP_API_URL = url(import.meta.env.VITE_ERP_API_URL, `${ERP_URL}/api`);

export const erpLinks = {
  home: ERP_URL,
  forgotPassword: `${ERP_URL}/forgot-password`,
  handoff: (returnTo: string) => `${ERP_URL}/accounting-handoff?return=${encodeURIComponent(returnTo)}`,
  login: `${ERP_API_URL}/auth/login`,
};
