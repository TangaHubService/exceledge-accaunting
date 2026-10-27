import React from 'react';
import type { SuppliersCardProps } from '../types/supplierTypes';
import { SearchBar } from './SearchBar';
import { SuppliersTable } from './SuppliersTable';
import { TableSkeleton } from '../../../../components/ui/TableSkeleton';
import { useTheme } from '../../../../context/ThemeContext';

export const SuppliersCard: React.FC<SuppliersCardProps> = ({
  loading,
  suppliers,
  searchTerm,
  onSearchChange,
  onAdd,
  onEdit,
  onDelete,
}) => {
  const { theme } = useTheme();

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${
      theme === "dark" ? "bg-gray-800/50 border-gray-700" : "bg-white border-gray-200"
    }`}>
      <div className="p-6 border-b border-gray-100 dark:border-gray-700/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className={`text-xl font-bold tracking-tight ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
              All Suppliers
            </h2>
            <p className={`text-sm mt-1 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
              View and manage all your suppliers
            </p>
          </div>
          <div className="w-full md:w-72">
            <SearchBar value={searchTerm} onChange={onSearchChange} />
          </div>
        </div>
      </div>
      <div className="p-0">
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={5} columns={6} />
          </div>
        ) : (
          <SuppliersTable
            suppliers={suppliers}
            onAdd={onAdd}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
};
