import React from 'react';
import { cn } from '../../lib/utils';

interface TableSkeletonProps {
  /**
   * Number of rows to display in the skeleton
   * @default 5
   */
  rows?: number;
  /**
   * Number of columns to display in the skeleton
   * @default 5
   */
  columns?: number;
  /**
   * Whether to show the header row
   * @default true
   */
  showHeader?: boolean;
  /**
   * Additional class names to apply to the table
   */
  className?: string;
  /**
   * Custom height for table rows
   * @default 'h-4'
   */
  rowHeight?: string;
  /**
   * Custom width for the header skeleton
   * @default 'w-3/4'
   */
  headerWidth?: string;
}

/**
 * A reusable table skeleton loader component that can be used while data is loading.
 * It provides a visual indication that content is being loaded and supports dark mode.
 */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rows = 5,
  columns = 5,
  showHeader = true,
  className = '',
  rowHeight = 'h-4',
  headerWidth = 'w-3/4',
}) => {
  return (
    <div className={cn('w-full overflow-hidden rounded-lg', className)}>
      <div className="w-full overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          {showHeader && (
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {[...Array(columns)].map((_, colIndex) => (
                  <th
                    key={`header-${colIndex}`}
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                  >
                    <div 
                      className={cn(
                        'h-4 rounded animate-pulse',
                        'bg-gray-200 dark:bg-gray-700',
                        headerWidth
                      )}
                    />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
            {[...Array(rows)].map((_, rowIndex) => (
              <tr 
                key={`row-${rowIndex}`} 
                className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                {[...Array(columns)].map((_, colIndex) => (
                  <td 
                    key={`cell-${rowIndex}-${colIndex}`} 
                    className="px-6 py-4 whitespace-nowrap"
                  >
                    <div 
                      className={cn(
                        'rounded animate-pulse',
                        'bg-gray-100 dark:bg-gray-800',
                        rowHeight,
                        colIndex % 3 === 0 ? 'w-full' : colIndex % 2 === 0 ? 'w-4/5' : 'w-2/3'
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableSkeleton;
