import { useEffect } from "react";
import { connectServerStore, hydrate, onServerSaveFailed } from "../lib/server-store";
import { useSession } from "../lib/session";
import { useFeedback } from "./feedback";

/** Loads the company's records when someone signs in, and says so when a background save fails. */
export function ServerStoreSync() {
  const { api } = useSession();
  const { toast } = useFeedback();

  useEffect(() => {
    connectServerStore(api);
    hydrate().catch((e: Error) => toast(`Couldn't load your saved records: ${e.message}`, { error: true }));
    // Only on sign-in: `api` changes identity when the token refreshes, and the data is already loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    connectServerStore(api);
  }, [api]);

  useEffect(
    () =>
      onServerSaveFailed((message) => {
        toast(`A change wasn't saved: ${message}`, { error: true });
        // Put the screens back to what the server actually holds.
        void hydrate().catch(() => undefined);
      }),
    [toast],
  );

  return null;
}
