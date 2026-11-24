import { useCallback, useState } from "react";
import { useResource, useSession } from "./session";

export type PrefValue = string | boolean;
export type Prefs = Record<string, PrefValue>;

/** One settings section, saved for the whole company. Sections are separate records so two people editing different ones don't overwrite each other. */
export function usePreferences(section: string, defaults: Prefs) {
  const { api, can } = useSession();
  const res = useResource<Array<{ id: string; values?: Prefs }>>("/api/v1/workspace/records/settings");
  const [local, setLocal] = useState<Prefs | null>(null);
  const saved = res.data?.find((r) => r.id === section)?.values;
  const values: Prefs = { ...defaults, ...saved, ...local };
  const save = useCallback(
    async (next: Prefs) => {
      await api(`/api/v1/workspace/records/settings/${section}`, { method: "PUT", body: JSON.stringify({ values: next }) });
      setLocal(next);
    },
    [api, section],
  );
  // Until the saved values are here, editing would overwrite them with defaults.
  const loaded = res.data !== undefined;
  return { values, save, loaded, error: res.error, reload: res.reload, canEdit: loaded && can("setup:prepare") };
}
