import React from 'react';
import type { SuppliersTableProps } from '../types/supplierTypes';
import { SupplierRow } from './SupplierRow';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../../context/ThemeContext';
import { Plus } from 'lucide-react';

export const SuppliersTable: React.FC<SuppliersTableProps> = ({ suppliers, onAdd, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  
  if (suppliers.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-center text-gray-500">
        <p>No suppliers found</p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          Add New Supplier
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto dark:bg-gray-800 rounded-lg">
      <table className="w-full">
        <thead className={theme === "dark" ? "bg-gray-700" : "bg-gray-50"}>
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-white">{t('common.id')}</th>
            <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-white">{t('common.name')}</th>
            <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-white">{t('common.email')}</th>
            <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-white">{t('common.phone')}</th>
            <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-white">{t('suppliers.contactPerson')}</th>
            <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-white">{t('common.address')}</th>
            <th className="py-3 px-4 text-right text-sm font-medium text-gray-700 dark:text-white">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 rounded-lg">
          {suppliers.map((supplier) => (
            <SupplierRow
              key={supplier.id}
              supplier={supplier}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
