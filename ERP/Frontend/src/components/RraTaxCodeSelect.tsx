import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { RraTaxCode, RRA_TAX_CODE_OPTIONS } from '../types/ebm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface RraTaxCodeSelectProps {
  value: RraTaxCode | string | null | undefined;
  onChange: (value: RraTaxCode) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function RraTaxCodeSelect({ value, onChange, error, disabled, className }: RraTaxCodeSelectProps) {
  const [options, setOptions] = useState(RRA_TAX_CODE_OPTIONS);

  useEffect(() => {
    apiClient.getRraCodeCatalog()
      .then((res: any) => {
        const data = res?.data ?? res;
        const types = (data?.taxTypes ?? []) as Array<{ code: string; label: string }>;
        if (types.length) {
          setOptions(types.map((t) => ({ value: t.code as RraTaxCode, label: t.label })));
        }
      })
      .catch(() => { /* keep last-resort static options */ });
  }, []);

  return (
    <div className="space-y-2">
      <Select
        value={value ?? undefined}
        onValueChange={(v) => onChange(v as RraTaxCode)}
        disabled={disabled}
      >
        <SelectTrigger className={error ? 'border-red-500' : className}>
          <SelectValue placeholder="Select tax code" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="text-red-500 text-sm">{error}</span>}
    </div>
  );
}
