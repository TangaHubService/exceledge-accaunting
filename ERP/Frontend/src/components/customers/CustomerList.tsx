
import { useTranslation } from 'react-i18next';
import { Shield, Eye, Edit, Trash2 } from 'lucide-react';

interface CustomerListProps {
  customers: any[];
  onEdit: (customer: any) => void;
  onViewDetails?: (customer: any) => void;
  onDelete?: (id: string) => void;
  isLoading: boolean;
}

export function CustomerList({ customers, onEdit, onViewDetails, onDelete, isLoading }: CustomerListProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="flex items-center space-x-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            <div className="h-12 w-12 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">{t('customers.noCustomersFound')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border border-gray-200 dark:border-gray-700 rounded-lg">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 dark:bg-gray-800">
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
              {t('common.id')}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
              {t('customers.table.name')}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
              {t('customers.table.contact')}
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
              {t('customers.table.type')}
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
              {t('customers.table.balance')}
            </th>
            <th className="text-center py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
              {t('customers.table.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {customers.map((customer) => (
            <tr key={customer.id}>
              <td className="py-4 px-4">
                {onViewDetails ? (
                  <button
                    onClick={() => onViewDetails(customer)}
                    className="text-sm font-mono text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                    title={t('common.clickToViewDetails')}
                  >
                    #{customer.id}
                  </button>
                ) : (
                  <div className="text-sm font-mono text-gray-600 dark:text-gray-400">
                    #{customer.id}
                  </div>
                )}
              </td>
              <td className="py-4 px-4">
                <div className="flex items-center">
                  <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-medium">
                    {customer.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="ml-4">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {customer.name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {t('customers.purchases', { count: customer._count?.sales })}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-4 px-4">
                <div className="text-sm text-gray-900 dark:text-white">{customer.email}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{customer.phone}</div>
              </td>
              <td className="py-4 px-4">
                {customer.type === 'INSURANCE' ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <Shield className="h-3 w-3 mr-1" />
                    {t('customers.insurance')}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {t('customers.individual')}
                  </span>
                )}
              </td>
              <td className="py-4 px-4 text-right">
                <span className={`font-medium ${parseFloat(customer.balance) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                  }`}>
                  {parseFloat(customer.balance).toLocaleString(undefined, {
                    style: 'currency',
                    currency: 'RWF',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </span>
              </td>
              <td className="py-4 px-4">
                <div className="flex items-center justify-center gap-2">
                  {onViewDetails && (
                    <button
                      onClick={() => onViewDetails(customer)}
                      className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors"
                      title={t('common.viewDetails') || 'View Details'}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(customer)}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors"
                    title={t('common.edit') || 'Edit'}
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  {onDelete && (
                    <button
                      onClick={() => onDelete(customer.id)}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                      title={t('common.delete') || 'Delete'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
