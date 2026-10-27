import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Badge } from '../ui/badge';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

export interface PreviewRow {
  rowNumber: number;
  [key: string]: any;
  errors?: string;
  errorDetails?: Array<{ field: string; message: string }>;
}

interface ImportPreviewTableProps {
  validRows: PreviewRow[];
  invalidRows: PreviewRow[];
  columns: string[];
}

export function ImportPreviewTable({
  validRows,
  invalidRows,
  columns,
}: ImportPreviewTableProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const allRows = [...validRows, ...invalidRows].sort((a, b) => a.rowNumber - b.rowNumber);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium text-green-600">
              {validRows.length} {t('import.valid')}
            </span>
          </div>
          {invalidRows.length > 0 && (
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm font-medium text-red-600">
                {invalidRows.length} {t('import.invalid')}
              </span>
            </div>
          )}
        </div>
      </div>

      <ScrollArea className={`w-full border rounded-xl overflow-hidden ${theme === "dark" ? "border-gray-800 bg-gray-900" : "border-gray-200 bg-white"
        }`}>
        <div className="min-w-full inline-block align-middle">
          <Table className="min-w-max">
            <TableHeader className={theme === "dark" ? "bg-gray-800/50" : "bg-gray-50"}>
              <TableRow className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                <TableHead className={`w-16 font-bold whitespace-nowrap ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                  {t('common.row')}
                </TableHead>
                <TableHead className={`font-bold whitespace-nowrap ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                  {t('common.status')}
                </TableHead>
                {columns.map((col) => (
                  <TableHead key={col} className={`capitalize font-bold whitespace-nowrap ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    {col.replace(/([A-Z])/g, ' $1').trim()}
                  </TableHead>
                ))}
                {invalidRows.length > 0 && (
                  <TableHead className={`font-bold whitespace-nowrap ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    {t('common.errors')}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 3} className="text-center py-12">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <AlertCircle className="h-8 w-8 text-gray-400" />
                      <p className={`text-base font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                        {t('common.noDataToPreview')}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                allRows.map((row, index) => {
                  const isValid = !row.errors;
                  return (
                    <TableRow
                      key={index}
                      className={`transition-colors border-b ${isValid
                        ? theme === "dark" ? 'hover:bg-green-950/30' : 'hover:bg-green-50/50'
                        : theme === "dark" ? 'bg-red-950/10 hover:bg-red-950/20' : 'bg-red-50/30 hover:bg-red-50/50'
                        }`}
                    >
                      <TableCell className={`font-mono text-xs whitespace-nowrap ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                        {row.rowNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {isValid ? (
                          <Badge className="bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20 px-2 py-0.5 rounded-md">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {t('import.valid')}
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20 px-2 py-0.5 rounded-md">
                            <XCircle className="h-3 w-3 mr-1" />
                            {t('import.invalid')}
                          </Badge>
                        )}
                      </TableCell>
                      {columns.map((col) => {
                        const value = row[col] ?? row[col.toLowerCase()] ?? '';
                        return (
                          <TableCell key={col} className={`text-sm whitespace-nowrap ${!isValid
                            ? theme === "dark" ? "text-red-300" : "text-red-700 font-medium"
                            : theme === "dark" ? "text-gray-300" : "text-gray-700"
                            }`}>
                            {value || '-'}
                          </TableCell>
                        );
                      })}
                      {invalidRows.length > 0 && (
                        <TableCell className="min-w-[200px]">
                          {!isValid && row.errors && (
                            <div className={`flex items-start gap-2 p-2 rounded-lg ${theme === "dark" ? "bg-red-950/30 border border-red-900/30" : "bg-red-50 border border-red-100"
                              }`}>
                              <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                              <span className={`text-xs leading-relaxed ${theme === "dark" ? "text-red-300" : "text-red-700"
                                }`}>
                                {row.errors}
                              </span>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </div>
  );
}
