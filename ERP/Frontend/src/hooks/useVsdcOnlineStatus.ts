import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';

export type VsdcStatus = 'healthy' | 'blocked';

interface VsdcStatusResult {
  status: VsdcStatus;
  hoursSinceSync: number;
  message: string | null;
  trainingMode: boolean;
}

interface EbmStatusPayload {
  enabled: boolean;
  online: boolean;
  trainingMode?: boolean;
  lastContact: string | null;
  offlineLimitMs: number;
}

const POLL_INTERVAL_MS = 30_000;

export function useVsdcOnlineStatus(): VsdcStatusResult {
  const [payload, setPayload] = useState<EbmStatusPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = (await apiClient.getEbmStatus()) as { data?: EbmStatusPayload };
        const data = res?.data;
        if (cancelled) return;
        setPayload(data ?? null);
      } catch {
        if (cancelled) return;
        setPayload(null);
      }
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!payload || !payload.enabled) {
    return { status: 'healthy', hoursSinceSync: 0, message: null, trainingMode: !!payload?.trainingMode };
  }

  const lastContact = payload.lastContact ? new Date(payload.lastContact) : null;
  const hoursSinceSync = lastContact
    ? Math.floor((Date.now() - lastContact.getTime()) / (60 * 60 * 1000))
    : 0;
  const limitHours = Math.round(payload.offlineLimitMs / (60 * 60 * 1000));

  if (!payload.online) {
    // last successful VSDC contact exceeded the block window
    return {
      status: 'blocked',
      hoursSinceSync,
      trainingMode: !!payload.trainingMode,
      message:
        `CRITICAL: EBM System Locked. No successful VSDC contact for ${hoursSinceSync}h (limit ${limitHours}h). ` +
        `Receipt generation is blocked until the gateway acknowledges a transaction. Contact administration.`,
    };
  }

  return { status: 'healthy', hoursSinceSync, message: null, trainingMode: !!payload.trainingMode };
}
