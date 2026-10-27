import { Search, Plus, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';

interface CustomerFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onAddCustomer: () => void;
  onImport?: () => void;
  isLoading: boolean;
}

export function CustomerFilters({
  searchTerm,
  onSearchChange,
  onAddCustomer,
  onImport,
  isLoading,
}: CustomerFiltersProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
      <div className="relative w-full sm:w-96 group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className={`h-5 w-5 transition-colors ${
            searchTerm ? 'text-blue-500' : 'text-gray-400 group-focus-within:text-blue-500'
          }`} />
        </div>
        <input
          type="text"
          placeholder={t('customers.searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
            theme === "dark"
              ? "bg-gray-800 border-gray-700 text-white placeholder-gray-500"
              : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 hover:border-gray-300 shadow-sm"
          }`}
          disabled={isLoading}
        />
        {searchTerm && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-0 pr-3 flex items-center hover:text-red-500 transition-colors"
          >
            <X className="h-4 w-4 text-gray-400 hover:text-inherit" />
          </button>
        )}
      </div>
      <div className="flex gap-3 w-full sm:w-auto">
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading}
          >
            <Upload className="-ml-1 mr-2 h-4 w-4" />
            {t('customers.import') || 'Import'}
          </button>
        )}
        <button
          type="button"
          onClick={onAddCustomer}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isLoading}
        >
          <Plus className="-ml-1 mr-2 h-4 w-4" />
          {t('customers.addCustomer')}
        </button>
      </div>
    </div>
  );
}
