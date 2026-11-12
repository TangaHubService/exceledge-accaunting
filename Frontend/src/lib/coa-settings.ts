import { useCallback } from "react";
import { useResource, useSession } from "./session";

export type CoaSettings = { useAccountNumbers: boolean };

/** QuickBooks "Enable account numbers", saved per company. Defaults to on while loading. */
export function useCoaSettings() {
  const { api } = useSession();
  const res = useResource<CoaSettings>("/api/v1/coa/settings");
  const useAccountNumbers = res.data?.useAccountNumbers ?? true;
  const setUseAccountNumbers = useCallback(
    async (on: boolean) => {
      await api<CoaSettings>("/api/v1/coa/settings", { method: "PUT", body: JSON.stringify({ useAccountNumbers: on }) });
      res.reload();
    },
    [api, res],
  );
  return { useAccountNumbers, loaded: res.data !== undefined, setUseAccountNumbers };
}

/** QuickBooks account numbers: up to 7 letters, digits, "." or "-". */
export const ACCOUNT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,6}$/;
