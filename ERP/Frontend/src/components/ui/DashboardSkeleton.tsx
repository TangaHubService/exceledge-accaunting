import { Skeleton } from './skeleton';

const TableRowSkeleton = () => (
    <tr className="animate-pulse">
        <td className="px-6 py-4 whitespace-nowrap">
            <Skeleton className="h-4 w-24 bg-gray-200 dark:bg-gray-600" />
            <Skeleton className="h-3 w-16 mt-1 bg-gray-100 dark:bg-gray-700" />
        </td>
        <td className="px-6 py-4">
            <Skeleton className="h-4 w-32 bg-gray-200 dark:bg-gray-600" />
            <Skeleton className="h-3 w-24 mt-1 bg-gray-100 dark:bg-gray-700" />
        </td>
        <td className="px-6 py-4 text-right">
            <Skeleton className="h-4 w-12 ml-auto bg-gray-200 dark:bg-gray-600" />
        </td>
        <td className="px-6 py-4 text-right">
            <Skeleton className="h-4 w-20 ml-auto bg-gray-200 dark:bg-gray-600" />
        </td>
        <td className="px-6 py-4 text-right">
            <Skeleton className="h-4 w-24 ml-auto bg-gray-200 dark:bg-gray-600" />
        </td>
    </tr>
);

const BarGraphSkeleton = () => (
    <div className="h-64 w-full flex items-end space-x-1 px-2">
        {[30, 50, 70, 40, 60, 45, 80].map((height, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
                <div 
                    className="w-8 bg-blue-200 dark:bg-blue-900 rounded-t animate-pulse"
                    style={{ height: `${height}%` }}
                />
                <Skeleton className="h-3 w-6 mt-2 bg-gray-200 dark:bg-gray-600" />
            </div>
        ))}
    </div>
);

const LineGraphSkeleton = () => (
    <div className="h-64 w-full relative">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-200 dark:bg-gray-700"></div>
        <div className="absolute left-0 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-full w-full relative overflow-hidden">
            <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-blue-50 to-transparent dark:from-blue-900/30 dark:to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-full h-1/2">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <div 
                        key={i}
                        className="absolute bottom-0 w-1 h-4 bg-blue-400 dark:bg-blue-500 rounded-full animate-pulse"
                        style={{
                            left: `${(i / 6) * 100}%`,
                            height: `${30 + (Math.random() * 70)}%`,
                            animationDelay: `${i * 0.1}s`,
                            animationDuration: '1.5s'
                        }}
                    />
                ))}
            </div>
        </div>
    </div>
);

export const DashboardSkeleton = () => {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center space-x-4">
                            <Skeleton className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/50" />
                            <div className="space-y-2">
                                <Skeleton className="h-6 w-48 bg-gray-200 dark:bg-gray-600" />
                                <Skeleton className="h-4 w-64 bg-gray-100 dark:bg-gray-700" />
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <Skeleton className="h-10 w-32 bg-gray-100 dark:bg-gray-700" />
                            <Skeleton className="h-10 w-24 bg-blue-100 dark:bg-blue-900/50" />
                        </div>
                    </div>
                </div>
                
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                    {[
                        { color: 'bg-blue-100 dark:bg-blue-900/50', icon: 'bg-blue-500' },
                        { color: 'bg-green-100 dark:bg-green-900/50', icon: 'bg-green-500' },
                        { color: 'bg-amber-100 dark:bg-amber-900/50', icon: 'bg-amber-500' }
                    ].map((item, i) => (
                        <div key={i} className={`${item.color} rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700`}>
                            <div className="flex items-center justify-between mb-4">
                                <Skeleton className={`h-10 w-10 rounded-lg ${item.icon} opacity-80`} />
                                <Skeleton className="h-6 w-20 bg-white/50 dark:bg-gray-600/50" />
                            </div>
                            <Skeleton className="h-8 w-32 bg-gray-200 dark:bg-gray-600 mb-2" />
                            <div className="mt-4 pt-4 border-t border-white/20">
                                <Skeleton className="h-3 w-3/4 bg-white/50 dark:bg-gray-600/50" />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
                            <Skeleton className="h-6 w-48 bg-gray-200 dark:bg-gray-600" />
                            <Skeleton className="h-8 w-24 bg-gray-100 dark:bg-gray-700" />
                        </div>
                        <div className="h-64 relative">
                            <BarGraphSkeleton />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Skeleton className="h-4 w-24 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 text-sm font-medium px-2 py-1 rounded" />
                            </div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
                            <Skeleton className="h-6 w-48 bg-gray-200 dark:bg-gray-600" />
                            <Skeleton className="h-8 w-24 bg-gray-100 dark:bg-gray-700" />
                        </div>
                        <div className="h-64 relative">
                            <LineGraphSkeleton />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Skeleton className="h-4 w-24 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 text-sm font-medium px-2 py-1 rounded" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Recent Transactions */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
                    <div className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
                            <Skeleton className="h-7 w-48 bg-gray-200 dark:bg-gray-600" />
                            <Skeleton className="h-9 w-32 bg-gray-100 dark:bg-gray-700 rounded-lg" />
                        </div>
                        
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700/50">
                                    <tr>
                                        {['Date & Time', 'Product', 'Qty', 'Unit Price', 'Total'].map((header, i) => (
                                            <th key={i} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700/50">
                                    {[1, 2, 3, 4, 5].map((row) => (
                                        <TableRowSkeleton key={row} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* Table Pagination */}
                        <div className="flex items-center justify-between mt-4 px-1">
                            <Skeleton className="h-4 w-24 bg-gray-100 dark:bg-gray-700" />
                            <div className="flex space-x-2">
                                <Skeleton className="h-8 w-8 rounded bg-gray-100 dark:bg-gray-700" />
                                <Skeleton className="h-8 w-8 rounded bg-blue-100 dark:bg-blue-900/50" />
                                <Skeleton className="h-8 w-8 rounded bg-gray-100 dark:bg-gray-700" />
                                <Skeleton className="h-8 w-8 rounded bg-gray-100 dark:bg-gray-700" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DashboardSkeleton;
