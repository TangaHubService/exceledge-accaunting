import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type Toast = { id: number; text: string; error?: boolean };
type ConfirmOptions = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };

type Feedback = {
  toast: (text: string, opts?: { error?: boolean }) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback() {
  const f = useContext(FeedbackContext);
  if (!f) throw new Error("useFeedback outside FeedbackProvider");
  return f;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, opts?: { error?: boolean }) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, error: opts?.error }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.error ? 7000 : 4000);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  function settle(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {pending && <ConfirmDialog options={pending} onSettle={settle} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions; onSettle: (ok: boolean) => void }) {
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButton.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onSettle(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSettle]);

  return (
    <>
      <div className="overlay top" onClick={() => onSettle(false)} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={options.title}>
        <h2>{options.title}</h2>
        {options.body && <p>{options.body}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={() => onSettle(false)}>
            Cancel
          </button>
          <button
            type="button"
            ref={confirmButton}
            className={`btn ${options.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </>
  );
}
