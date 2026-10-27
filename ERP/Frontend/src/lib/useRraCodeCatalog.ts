import { useCallback, useEffect, useState } from 'react';
import { apiClient } from './api-client';

export interface RraCodeOption {
  code: string;
  label: string;
  rate?: number;
  category?: string;
  description?: string | null;
  name?: string;
}

export interface RraCodeCatalog {
  taxTypes: Array<{ code: string; label: string; rate: number; category: string }>;
  tourismTaxCategories: Array<{ code: string; label: string; rate: number }>;
  tourismTaxTypes: Array<{ code: string; label: string }>;
  countries: Array<{ code: string; label: string }>;
  propertyTypes: Array<{ code: string; label: string }>;
  roomTypes: Array<{ code: string; label: string }>;
  qtyUnits: Array<{ code: string; label: string }>;
  pkgUnits: Array<{ code: string; label: string }>;
  refundReasons: Array<{ code: string; name: string; description: string | null }>;
  paymentTypes: Array<{ code: string; label: string }>;
  itemTypes: Array<{ code: string; label: string }>;
  cachedCount: number;
}

function unwrapCatalog(res: unknown): RraCodeCatalog | null {
  if (!res || typeof res !== 'object') return null;
  const root = res as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Partial<RraCodeCatalog>;
  if (!data || typeof data !== 'object') return null;
  return {
    taxTypes: data.taxTypes ?? [],
    tourismTaxCategories: data.tourismTaxCategories ?? [],
    tourismTaxTypes: data.tourismTaxTypes ?? [],
    countries: data.countries ?? [],
    propertyTypes: data.propertyTypes ?? [],
    roomTypes: data.roomTypes ?? [],
    qtyUnits: data.qtyUnits ?? [],
    pkgUnits: data.pkgUnits ?? [],
    refundReasons: data.refundReasons ?? [],
    paymentTypes: data.paymentTypes ?? [],
    itemTypes: data.itemTypes ?? [],
    cachedCount: data.cachedCount ?? 0,
  };
}

const EMPTY: RraCodeCatalog = {
  taxTypes: [],
  tourismTaxCategories: [],
  tourismTaxTypes: [],
  countries: [],
  propertyTypes: [],
  roomTypes: [],
  qtyUnits: [],
  pkgUnits: [],
  refundReasons: [],
  paymentTypes: [],
  itemTypes: [],
  cachedCount: 0,
};

export function useRraCodeCatalog() {
  const [catalog, setCatalog] = useState<RraCodeCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getRraCodeCatalog();
      const next = unwrapCatalog(res);
      setCatalog(next ?? EMPTY);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load RRA codes');
      setCatalog(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { catalog, loading, error, reload };
}
