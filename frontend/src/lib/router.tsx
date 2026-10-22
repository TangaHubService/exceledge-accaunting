import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function snapshot() {
  return window.location.pathname + window.location.search;
}

export function navigate(to: string, { replace = false } = {}) {
  if (to === snapshot()) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  listeners.forEach((l) => l());
  if (!replace) window.scrollTo(0, 0);
}

export function useLocation() {
  const full = useSyncExternalStore(subscribe, snapshot);
  const [path, search = ""] = full.split("?");
  return { path, query: new URLSearchParams(search) };
}

/** Update one query parameter without adding a history entry. */
export function setQueryParam(key: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  const qs = params.toString();
  navigate(window.location.pathname + (qs ? `?${qs}` : ""), { replace: true });
}

/** Match "/customers/:id" against a path; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...rest} />;
}

/** True when `path` is the same as `to` (ignoring query) or a nested child of it. */
export function isPathActive(path: string, to: string | undefined): boolean {
  if (!to) return false;
  const base = to.split("?")[0] || "/";
  if (base === "/") return path === "/";
  return path === base || path.startsWith(`${base}/`);
}

/** Soft redirect that keeps history tidy (replace). */
export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}
