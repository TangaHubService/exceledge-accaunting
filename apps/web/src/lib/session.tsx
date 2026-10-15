import { type AccountingCapability, capabilitiesForRole } from "@exceledge/accounting-domain";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { accountingUrl, erpLinks } from "./config";

const TOKEN_KEY = "erp_jwt";
const REFRESH_KEY = "erp_refresh";
const REMEMBER_EMAIL_KEY = "erp_remember_email";

type TokenClaims = { userId?: number; email?: string; role?: string; name?: string; exp?: number };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Envelope<T> = { success: boolean; data?: T; error?: string; message?: string };

export type Session = {
  token: string;
  email?: string;
  role?: string;
  can: (capability: AccountingCapability) => boolean;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** Like `api`, but also returns the envelope message (used by activation). */
  apiWithMessage: <T>(path: string, init?: RequestInit) => Promise<{ data: T; message?: string }>;
  download: (path: string, filename: string) => Promise<void>;
  signOut: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function readInitialToken() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const handoff = hash.get("access_token");
  if (handoff) {
    storeToken(handoff, true);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return handoff;
  }
  const stored = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? "";
  const claims = decodeClaims(stored);
  if (claims?.exp && claims.exp * 1000 < Date.now() && !readRefreshToken()) {
    clearToken();
    return "";
  }
  return stored;
}

function readRefreshToken() {
  return localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY) ?? "";
}

let refreshing: Promise<string | null> | null = null;

/** ERP access tokens are short-lived; trade the refresh token for a new pair once, shared by concurrent callers. */
function refreshAccessToken(): Promise<string | null> {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return Promise.resolve(null);
  refreshing ??= (async () => {
    try {
      const res = await fetch(erpLinks.refresh, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!body.accessToken) return null;
      storeToken(body.accessToken, localStorage.getItem(REFRESH_KEY) !== null, body.refreshToken ?? refreshToken);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function readRememberedEmail() {
  return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? "";
}

export function storeToken(token: string, remember = true, refreshToken?: string) {
  const keep = remember ? localStorage : sessionStorage;
  const drop = remember ? sessionStorage : localStorage;
  keep.setItem(TOKEN_KEY, token);
  drop.removeItem(TOKEN_KEY);
  drop.removeItem(REFRESH_KEY);
  if (refreshToken) keep.setItem(REFRESH_KEY, refreshToken);
  else keep.removeItem(REFRESH_KEY);
}

export function rememberEmail(email: string | null) {
  if (email) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
  else localStorage.removeItem(REMEMBER_EMAIL_KEY);
}

export function clearToken() {
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_KEY);
  }
}

function decodeClaims(token: string): TokenClaims | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as TokenClaims;
  } catch {
    return null;
  }
}

/** Turn a backend error into something a bookkeeper can act on. */
function friendlyError(status: number, raw: string | undefined): string {
  if (status === 401) return "Your session has ended. Please sign in again.";
  if (status === 403) return "You don't have permission to do this. Ask an administrator for access.";
  if (status >= 500) return "Something went wrong on our side. Please try again in a moment.";
  if (!raw) return status === 404 ? "We couldn't find that record." : "The request couldn't be completed.";
  if (raw.trimStart().startsWith("[")) {
    try {
      const issues = JSON.parse(raw) as Array<{ path?: Array<string | number>; message?: string }>;
      return issues
        .map((i) => {
          const field = i.path?.filter((p) => typeof p === "string").join(" ");
          return field ? `${humanField(field)}: ${i.message ?? "invalid"}` : (i.message ?? "Invalid value");
        })
        .join(". ");
    } catch {
      return "Some of the details entered aren't valid.";
    }
  }
  return raw;
}

function humanField(field: string) {
  const spaced = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function SessionProvider({
  token,
  onSignOut,
  onTokenRefreshed,
  children,
}: {
  token: string;
  onSignOut: (reason?: "expired") => void;
  onTokenRefreshed: (token: string) => void;
  children: ReactNode;
}) {
  const claims = useMemo(() => decodeClaims(token), [token]);
  const capabilities = useMemo(() => new Set(capabilitiesForRole(claims?.role)), [claims]);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (expired) onSignOut("expired");
  }, [expired, onSignOut]);

  const call = useCallback<Session["apiWithMessage"]>(
    async <T,>(path: string, init?: RequestInit) => {
      const send = (bearer: string) =>
        fetch(accountingUrl(path), {
          ...init,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
            ...(init?.headers ?? {}),
          },
        });
      let res: Response;
      try {
        res = await send(token);
        if (res.status === 401) {
          const renewed = await refreshAccessToken();
          if (renewed) {
            onTokenRefreshed(renewed);
            res = await send(renewed);
          }
        }
      } catch {
        throw new ApiError("Can't reach the accounting service. Check your connection and try again.", 0);
      }
      let body: Envelope<T> | null = null;
      try {
        body = (await res.json()) as Envelope<T>;
      } catch {
        body = null;
      }
      if (res.status === 401) setExpired(true);
      if (!res.ok || !body?.success) {
        throw new ApiError(friendlyError(res.ok ? 400 : res.status, body?.error ?? body?.message), res.status);
      }
      return { data: body.data as T, message: body.message };
    },
    [token, onTokenRefreshed],
  );

  const session = useMemo<Session>(
    () => ({
      token,
      email: claims?.email,
      role: claims?.role,
      can: (c) => capabilities.has(c),
      api: async <T,>(path: string, init?: RequestInit) => (await call<T>(path, init)).data,
      apiWithMessage: call,
      download: async (path, filename) => {
        let res = await fetch(accountingUrl(path), { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) {
          const renewed = await refreshAccessToken();
          if (renewed) {
            onTokenRefreshed(renewed);
            res = await fetch(accountingUrl(path), { headers: { Authorization: `Bearer ${renewed}` } });
          }
        }
        if (res.status === 401) setExpired(true);
        if (!res.ok) throw new ApiError(friendlyError(res.status, undefined), res.status);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      },
      signOut: () => onSignOut(),
    }),
    [token, claims, capabilities, call, onSignOut, onTokenRefreshed],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

type ResourceState<T> = { path: string | null; data?: T; error?: string; loading: boolean };

/** Load a GET endpoint; pass `null` to skip (e.g. when the user lacks access). */
export function useResource<T>(path: string | null) {
  const { api } = useSession();
  const [state, setState] = useState<ResourceState<T>>({ path, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ path, loading: false });
      return;
    }
    let live = true;
    // Keep the previous data while refreshing the same resource, drop it when switching.
    setState((s) => ({ path, data: s.path === path ? s.data : undefined, loading: true }));
    api<T>(path)
      .then((data) => live && setState({ path, data, loading: false }))
      .catch(
        (e: Error) =>
          live && setState((s) => ({ path, data: s.path === path ? s.data : undefined, error: e.message, loading: false })),
      );
    return () => {
      live = false;
    };
  }, [path, nonce, api]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.path === path;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: current ? state.loading : Boolean(path),
    reload,
  };
}
