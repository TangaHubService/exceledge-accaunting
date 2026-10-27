import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { SupplierRowProps } from '../types/supplierTypes';

export const SupplierRow: React.FC<SupplierRowProps> = ({ supplier, onEdit, onDelete }) => {
  return (
    <tr className="border-b hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white transition-colors">
      <td className="py-3 px-4 font-mono text-xs text-gray-500 dark:text-gray-400">#{supplier.id}</td>
      <td className="py-3 px-4 font-medium">{supplier.name}</td>
      <td className="py-3 px-4 text-sm">{supplier.email}</td>
      <td className="py-3 px-4 text-sm font-mono">{supplier.phone || "-"}</td>
      <td className="py-3 px-4 text-sm">{supplier.contactPerson || "-"}</td>
      <td className="py-3 px-4 text-sm">{supplier.address || "-"}</td>
      <td className="py-3 px-4 text-right">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onEdit(supplier)}
            className="p-2 hover:bg-gray-200 rounded-md transition-colors"
            aria-label="Edit supplier"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(supplier.id)}
            className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
            aria-label="Delete supplier"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
};
