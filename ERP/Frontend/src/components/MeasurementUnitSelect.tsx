import { MeasurementUnit, MEASUREMENT_UNIT_OPTIONS } from '../types/ebm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface MeasurementUnitSelectProps {
  value: MeasurementUnit | null | undefined;
  onChange: (value: MeasurementUnit) => void;
  error?: string;
  disabled?: boolean;
}

export function MeasurementUnitSelect({ value, onChange, error, disabled }: MeasurementUnitSelectProps) {
  return (
    <div className="space-y-2">
      <Select
        value={value ?? undefined}
        onValueChange={(v) => onChange(v as MeasurementUnit)}
        disabled={disabled}
      >
        <SelectTrigger className={error ? 'border-red-500' : ''}>
          <SelectValue placeholder="Select unit" />
        </SelectTrigger>
        <SelectContent>
          {MEASUREMENT_UNIT_OPTIONS.map((opt) => (
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
