import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { toast } from 'react-toastify';
import {
  Upload,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  ArrowLeft,
  Loader2,
  SkipForward,
  Download,
} from 'lucide-react';

/* ─── Types ─────────────────────────────────────────── */

interface ImportError {
  rowNumber: number;
  field: string;
  message: string;
  /** Suggested corrected value (optional) */
  suggestion?: string;
}

interface ColumnMapping {
  csvHeader: string;
  systemField: string;
}

interface BulkImportProps {
  /** Available system fields for column mapping */
  systemFields: { value: string; label: string; required?: boolean }[];
  /** Called with parsed, validated, and optionally corrected data */
  onImport: (rows: Record<string, any>[]) => Promise<void>;
  /** Called to validate a single row. Return null if valid, or error messages. */
  validateRow?: (row: Record<string, any>) => ImportError[] | null;
  /** Example CSV template download handler */
  onDownloadTemplate?: () => void;
  /** Loading state */
  loading?: boolean;
}

/* ─── CSV parsing (lightweight, no external dep) ──── */

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/* ─── Default validation ───────────────────────────── */

function defaultValidate(row: Record<string, any>): ImportError[] | null {
  const errors: ImportError[] = [];
  if (!row.name && !row.productName) {
    errors.push({ rowNumber: row._rowNumber, field: 'name', message: 'Product name is required' });
  }
  if (!row.sku) {
    errors.push({ rowNumber: row._rowNumber, field: 'sku', message: 'SKU is required' });
  }
  if (row.unitPrice && isNaN(Number(row.unitPrice))) {
    errors.push({ rowNumber: row._rowNumber, field: 'unitPrice', message: 'Invalid price format' });
  }
  return errors.length > 0 ? errors : null;
}

/* ─── System field options ─────────────────────────── */

const DEFAULT_SYSTEM_FIELDS = [
  { value: 'name', label: 'Product Name', required: true },
  { value: 'sku', label: 'SKU', required: true },
  { value: 'description', label: 'Description' },
  { value: 'category', label: 'Category', required: true },
  { value: 'brand', label: 'Brand' },
  { value: 'unitPrice', label: 'Selling Price', required: true },
  { value: 'costPrice', label: 'Cost Price' },
  { value: 'minStock', label: 'Minimum Stock' },
  { value: 'maxStock', label: 'Maximum Stock' },
  { value: 'batchNumber', label: 'Batch Number' },
  { value: 'expiryDate', label: 'Expiry Date' },
  { value: 'quantity', label: 'Initial Quantity' },
  { value: 'barcode', label: 'Barcode' },
  { value: 'unitOfMeasure', label: 'Unit of Measure' },
  { value: 'supplierId', label: 'Supplier ID' },
  { value: 'branchCode', label: 'Branch Code' },
];

/* ─── Component ─────────────────────────────────────── */

export function BulkImport({
  systemFields = DEFAULT_SYSTEM_FIELDS,
  onImport,
  validateRow = defaultValidate,
  onDownloadTemplate,
}: BulkImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Wizard step: upload → mapping → validation → review → done */
  const [step, setStep] = useState<'upload' | 'mapping' | 'validation' | 'review' | 'done'>('upload');

  /* Raw parsed data */
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);

  /* Column mapping */
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);

  /* Validation results */
  const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  const [resolvedErrors, setResolvedErrors] = useState<Record<string, string>>({});

  /* Processing */
  const [importing, setImporting] = useState(false);

  /* ── File handlers ──────────────────────────────────── */

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);

      if (headers.length === 0) {
        toast.error('Could not parse CSV. Check the file format.');
        return;
      }

      setCsvHeaders(headers);
      setCsvRows(rows);
      setStep('mapping');

      /* Auto-map: match by lowercase name */
      const autoMap: ColumnMapping[] = headers.map(h => {
        const clean = h.toLowerCase().replace(/[\s_-]+/g, '');
        const match = DEFAULT_SYSTEM_FIELDS.find(
          f => f.value.toLowerCase() === clean || f.label.toLowerCase().replace(/[\s_-]+/g, '') === clean,
        );
        return { csvHeader: h, systemField: match?.value ?? '' };
      });
      setMappings(autoMap);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  /* ── Column mapping ──────────────────────────────────── */
  const unmappedFields = useMemo(
    () => systemFields.filter(f => !mappings.some(m => m.systemField === f.value)),
    [mappings, systemFields],
  );

  const setMapping = useCallback((csvHeader: string, systemField: string) => {
    setMappings(prev =>
      prev.map(m => (m.csvHeader === csvHeader ? { ...m, systemField } : m)),
    );
  }, []);

  /* ── Run validation ──────────────────────────────────── */
  const runValidation = useCallback(() => {
    /* Build row objects */
    const rows: Record<string, any>[] = csvRows.map((row, idx) => {
      const obj: Record<string, any> = { _rowNumber: idx + 2 };
      mappings.forEach((m, ci) => {
        if (m.systemField && row[ci] !== undefined) {
          obj[m.systemField] = row[ci];
        }
      });
      return obj;
    });

    /* Validate each */
    const allErrors: ImportError[] = [];
    rows.forEach(row => {
      const rowErrors = validateRow(row);
      if (rowErrors) allErrors.push(...rowErrors);
    });

    setParsedRows(rows);
    setErrors(allErrors);
    setSkippedRows(new Set());
    setResolvedErrors({});
    setStep('validation');
  }, [csvRows, mappings, validateRow]);

  /* ── Error resolution ────────────────────────────────── */
  const skipRow = useCallback((rowNumber: number) => {
    setSkippedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }, []);

  const resolveError = useCallback((key: string, value: string) => {
    setResolvedErrors(prev => ({ ...prev, [key]: value }));
  }, []);

  /* ── Group errors ────────────────────────────────────── */
  const groupedErrors = useMemo(() => {
    const groups: Record<string, { message: string; rows: number[]; field: string }> = {};
    errors.forEach(e => {
      const key = `${e.field}:${e.message}`;
      if (!groups[key]) {
        groups[key] = { message: e.message, field: e.field, rows: [] };
      }
      groups[key].rows.push(e.rowNumber);
    });
    return Object.entries(groups).map(([key, g]) => ({
      ...g,
      key,
      count: g.rows.length,
      // Whether all rows in this group are skipped
      allSkipped: g.rows.every(r => skippedRows.has(r)),
    }));
  }, [errors, skippedRows]);

  /* ── Import ───────────────────────────────────────────── */
  const handleImport = async () => {
    setImporting(true);
    try {
      /* Build final row set: skip rows marked as skipped, apply resolved errors */
      const finalRows = parsedRows
        .filter(row => !skippedRows.has(row._rowNumber))
        .map(row => {
          const cleaned = { ...row };
          /* Apply resolved errors */
          Object.entries(resolvedErrors).forEach(([key, value]) => {
            const [r, field] = key.split(':');
            if (parseInt(r) === row._rowNumber) {
              cleaned[field] = value;
            }
          });
          /* Remove internal fields */
          delete cleaned._rowNumber;
          /* Clean empty strings */
          Object.keys(cleaned).forEach(k => {
            if (cleaned[k] === '' || cleaned[k] === undefined || cleaned[k] === null) {
              delete cleaned[k];
            }
          });
          return cleaned;
        });

      await onImport(finalRows);
      setStep('done');
    } catch (err: any) {
      toast.error(err?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  /* ── Reset ────────────────────────────────────────────── */
  const reset = useCallback(() => {
    setStep('upload');
    setCsvHeaders([]);
    setCsvRows([]);
    setMappings([]);
    setParsedRows([]);
    setErrors([]);
    setSkippedRows(new Set());
    setResolvedErrors({});
  }, []);

  /* ── Render steps ─────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Step indicator ───────────────────────────── */}
      <StepBar current={step} />

      {/* ── Upload step ──────────────────────────────── */}
      {step === 'upload' && (
        <UploadStep
          onFile={handleFile}
          onDrop={handleDrop}
          onBrowse={() => fileInputRef.current?.click()}
          onDownloadTemplate={onDownloadTemplate}
          fileInputRef={fileInputRef}
        />
      )}

      {/* ── Column mapping step ──────────────────────── */}
      {step === 'mapping' && (
        <MappingStep
          csvHeaders={csvHeaders}
          csvRows={csvRows.slice(0, 3)}
          mappings={mappings}
          systemFields={systemFields}
          unmappedFields={unmappedFields}
          onSetMapping={setMapping}
          onBack={() => setStep('upload')}
          onContinue={runValidation}
        />
      )}

      {/* ── Validation step ──────────────────────────── */}
      {step === 'validation' && (
        <ValidationStep
          parsedRows={parsedRows}
          errors={errors}
          groupedErrors={groupedErrors}
          skippedRows={skippedRows}
          resolvedErrors={resolvedErrors}
          onSkipRow={skipRow}
          onResolveError={resolveError}
          onBack={() => setStep('mapping')}
          onContinue={handleImport}
          importing={importing}
        />
      )}

      {/* ── Done step ────────────────────────────────── */}
      {step === 'done' && <DoneStep onReset={reset} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Sub-step components
   ═══════════════════════════════════════════════════════ */

/* ── Step bar ─────────────────────────────────────────── */
const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'mapping', label: 'Column Mapping' },
  { id: 'validation', label: 'Review & Fix' },
  { id: 'done', label: 'Complete' },
] as const;

function StepBar({ current }: { current: string }) {
  const idx = STEPS.findIndex(s => s.id === current);

  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                i < idx && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                i === idx && 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
                i > idx && 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
              )}
            >
              {i < idx ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                'text-sm font-medium',
                i === idx && 'text-gray-900 dark:text-gray-100',
                i !== idx && 'text-gray-400 dark:text-gray-500',
              )}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                'h-px flex-1 min-w-[16px]',
                i < idx ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-gray-200 dark:bg-gray-700',
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Upload step ───────────────────────────────────────── */

function UploadStep({
  onFile,
  onDrop,
  onBrowse,
  onDownloadTemplate,
  fileInputRef,
}: {
  onFile: (f: File) => void;
  onDrop: (e: React.DragEvent) => void;
  onBrowse: () => void;
  onDownloadTemplate?: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-4">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { onDrop(e); setDragging(false); }}
        onClick={onBrowse}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 transition-colors',
          dragging
            ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500 dark:hover:bg-gray-700',
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
          <Upload className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="text-center">
          <p className="text-base font-medium text-gray-700 dark:text-gray-200">
            Drop your CSV here or click to browse
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Supports .csv files with product data
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />

      {onDownloadTemplate && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDownloadTemplate}
            className="gap-2 text-gray-500"
          >
            <Download className="h-4 w-4" />
            Download CSV template
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Mapping step ──────────────────────────────────────── */

function MappingStep({
  csvHeaders,
  csvRows,
  mappings,
  systemFields,
  unmappedFields,
  onSetMapping,
  onBack,
  onContinue,
}: {
  csvHeaders: string[];
  csvRows: string[][];
  mappings: ColumnMapping[];
  systemFields: { value: string; label: string; required?: boolean }[];
  unmappedFields: { value: string; label: string; required?: boolean }[];
  onSetMapping: (header: string, field: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const hasRequiredUnmapped = unmappedFields.some(f => f.required);

  return (
    <div className="space-y-6">
      {/* Preview data */}
      <div className="rounded-xl border bg-white shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
        <div className="border-b px-6 py-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Column Mapping
          </h3>
          <p className="text-xs text-gray-500">
            Map each CSV column to a system field. Required fields are marked with *.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">CSV Column</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Maps To</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Preview</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {csvHeaders.map((header, i) => {
                const mapping = mappings.find(m => m.csvHeader === header);
                const isMapped = !!mapping?.systemField;
                const isRequired = systemFields.find(f => f.value === mapping?.systemField)?.required;

                return (
                  <tr key={header} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        {header}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={mapping?.systemField ?? '_skip'}
                        onValueChange={v => onSetMapping(header, v === '_skip' ? '' : v)}
                      >
                        <SelectTrigger className="h-10 w-56">
                          <SelectValue placeholder="Skip column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_skip">— Skip column —</SelectItem>
                          {systemFields.map(f => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}{f.required ? ' *' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-gray-500">
                      {csvRows[0]?.[i] ?? ''}
                    </td>
                    <td className="px-4 py-3">
                      {isMapped ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          {isRequired ? 'Required' : 'Mapped'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-gray-200 text-gray-400 dark:border-gray-600">
                          Skipped
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unmapped required fields warning */}
      {hasRequiredUnmapped && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {unmappedFields.filter(f => f.required).length} required field(s) not mapped
            </p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {unmappedFields.filter(f => f.required).map(f => f.label).join(', ')} — map a CSV column to these fields or add them later.
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="h-11 gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button type="button" onClick={onContinue} className="h-11 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
          Validate {csvRows.length} rows
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ── Validation step ────────────────────────────────────── */

function ValidationStep({
  parsedRows,
  errors,
  groupedErrors,
  skippedRows,
  resolvedErrors,
  onSkipRow,
  onResolveError,
  onBack,
  onContinue,
  importing,
}: {
  parsedRows: Record<string, any>[];
  errors: ImportError[];
  groupedErrors: { key: string; field: string; message: string; rows: number[]; count: number; allSkipped: boolean }[];
  skippedRows: Set<number>;
  resolvedErrors: Record<string, string>;
  onSkipRow: (rowNumber: number) => void;
  onResolveError: (key: string, value: string) => void;
  onBack: () => void;
  onContinue: () => void;
  importing: boolean;
}) {
  const errorRowNumbers = new Set(errors.map(e => e.rowNumber));

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {parsedRows.filter(r => !errorRowNumbers.has(r._rowNumber)).length} valid
          </span>
        </div>
        {errors.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <span className="text-sm font-medium text-red-700 dark:text-red-300">
                {errorRowNumbers.size} row(s) with errors
              </span>
            </div>
            <div className="flex items-center gap-2">
              <SkipForward className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {skippedRows.size} skipped
              </span>
            </div>
          </>
        )}
      </div>

      {/* Error groups */}
      {groupedErrors.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Errors to resolve</h3>
          {groupedErrors.map(group => (
            <div
              key={group.key}
              className={cn(
                'rounded-lg border p-4',
                group.allSkipped
                  ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                  : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle className={cn('h-4 w-4', group.allSkipped ? 'text-gray-400' : 'text-red-500')} />
                    <span className={cn('text-sm font-medium', group.allSkipped ? 'text-gray-500' : 'text-red-700 dark:text-red-300')}>
                      {group.field} — {group.message}
                    </span>
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      {group.count} row{group.count > 1 ? 's' : ''}
                    </Badge>
                  </div>

                  {/* Row numbers */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.rows.map(r => {
                      const isSkipped = skippedRows.has(r);
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => onSkipRow(r)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                            isSkipped
                              ? 'bg-gray-200 text-gray-500 line-through dark:bg-gray-700 dark:text-gray-400'
                              : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-red-50 hover:ring-red-300 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-red-900/20',
                          )}
                          title={isSkipped ? 'Remove skip' : 'Skip this row'}
                        >
                          Row {r}
                          {isSkipped && <SkipForward className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Inline resolution per row */}
                  {!group.allSkipped && (
                    <div className="mt-3 space-y-2">
                      {group.rows
                        .filter(r => !skippedRows.has(r))
                        .map(r => {
                          const err = errors.find(e => e.rowNumber === r && e.field === group.field);
                          if (!err) return null;
                          const resolveKey = `${r}:${group.field}`;
                          const resolvedValue = resolvedErrors[resolveKey] ?? err.suggestion ?? '';
                          return (
                            <div key={resolveKey} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-12 shrink-0">Row {r}:</span>
                              <Input
                                value={resolvedValue}
                                onChange={e => onResolveError(resolveKey, e.target.value)}
                                placeholder={err.suggestion ?? `Enter corrected ${group.field}`}
                                className="h-9 flex-1 text-sm"
                              />
                              {err.suggestion && resolvedValue !== err.suggestion && (
                                <button
                                  type="button"
                                  onClick={() => onResolveError(resolveKey, err.suggestion!)}
                                  className="text-xs text-blue-600 hover:underline shrink-0"
                                >
                                  Use suggestion
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* Skip-all for this group */}
                <button
                  type="button"
                  onClick={() => group.rows.forEach(r => onSkipRow(r))}
                  className={cn(
                    'shrink-0 rounded-md p-1.5 text-xs font-medium transition-colors',
                    group.allSkipped
                      ? 'bg-gray-200 text-gray-500 dark:bg-gray-700'
                      : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700',
                  )}
                  title="Skip all rows with this error"
                >
                  Skip all
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="h-11 gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back to Mapping
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={importing}
          className="h-11 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import {parsedRows.filter(r => !skippedRows.has(r._rowNumber) && !errorRowNumbers.has(r._rowNumber)).length} valid rows
          {skippedRows.size > 0 && ` (${skippedRows.size} skipped)`}
        </Button>
      </div>
    </div>
  );
}

/* ── Done step ─────────────────────────────────────────── */

function DoneStep({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border bg-white p-12 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
        <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Import Complete</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Your products have been imported successfully.
        </p>
      </div>
      <Button type="button" onClick={onReset} variant="outline" className="mt-2 h-11 gap-2">
        <RefreshCw className="h-4 w-4" />
        Import Another File
      </Button>
    </div>
  );
}
