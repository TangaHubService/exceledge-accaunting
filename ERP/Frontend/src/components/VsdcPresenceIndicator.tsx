import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';

type PresenceState = 'checking' | 'online' | 'offline' | 'disabled' | 'training';

interface EbmStatusPayload {
  enabled: boolean;
  online: boolean;
  trainingMode?: boolean;
  lastContact: string | null;
  offlineLimitMs: number;
}

const POLL_INTERVAL_MS = 30_000;

function stateStyles(state: PresenceState): { dot: string; text: string; pill: string; label: string } {
  switch (state) {
    case 'online':
      return {
        dot: 'bg-emerald-400',
        text: 'text-emerald-300',
        pill: 'border-emerald-400/40 bg-emerald-500/10',
        label: 'VSDC Online',
      };
    case 'offline':
      return {
        dot: 'bg-red-500',
        text: 'text-red-300',
        pill: 'border-red-500/40 bg-red-500/10',
        label: 'VSDC Offline',
      };
    case 'checking':
      return {
        dot: 'bg-amber-400 animate-pulse',
        text: 'text-amber-300',
        pill: 'border-amber-400/40 bg-amber-500/10',
        label: 'VSDC …',
      };
    case 'training':
      return {
        dot: 'bg-orange-400',
        text: 'text-orange-300',
        pill: 'border-orange-400/40 bg-orange-500/10',
        label: 'TRAINING',
      };
    default:
      return {
        dot: 'bg-slate-400',
        text: 'text-slate-300',
        pill: 'border-slate-400/40 bg-slate-500/10',
        label: 'VSDC Disabled',
      };
  }
}

export function VsdcPresenceIndicator() {
  const [state, setState] = useState<PresenceState>('checking');
  const [lastContact, setLastContact] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      setState((prev) => (prev === 'disabled' ? 'disabled' : 'checking'));
      try {
        const res = (await apiClient.getEbmStatus()) as { data?: EbmStatusPayload };
        const payload = res?.data;
        if (cancelled) return;
        if (!payload?.enabled) {
          setState(payload?.trainingMode ? 'training' : 'disabled');
          setLastContact(null);
          return;
        }
        // Training receipts need VSDC too, so offline wins over the training badge.
        setState(!payload.online ? 'offline' : payload.trainingMode ? 'training' : 'online');
        setLastContact(payload.lastContact ? new Date(payload.lastContact) : null);
      } catch {
        if (cancelled) return;
        setState('disabled');
        setLastContact(null);
      }
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const s = stateStyles(state);
  const title = lastContact
    ? `Last successful VSDC contact: ${lastContact.toLocaleString()}`
    : 'VSDC / EBM gateway presence';

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.pill}`}
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className={s.text}>{s.label}</span>
    </span>
  );
}
