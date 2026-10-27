import React from 'react';
import { Link, useLocation } from 'react-router-dom';

interface SystemOwnerLayoutProps {
    children: React.ReactNode;
    userName?: string;
    onTabChange?: (tab: string) => void;
}

const SystemOwnerLayout: React.FC<SystemOwnerLayoutProps> = ({ children, userName = 'System Owner', onTabChange }) => {
    const location = useLocation();
    const activeTab = location.pathname.split('/').pop() || 'overview';

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'subscriptions', label: 'Subscriptions' },
        { id: 'payments', label: 'Payments' },
        { id: 'analytics', label: 'Analytics' },
    ];

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 shadow border-b border-gray-200 dark:border-gray-700">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between ">
                        <div className="flex">
                            <nav className="hidden sm:ml-6 sm:flex sm:space-x-8">
                                {tabs.map((tab) => (
                                    <Link
                                        key={tab.id}
                                        to={`/my-system/${tab.id}`}
                                        onClick={() => onTabChange?.(tab.id)}
                                        className={`${activeTab === tab.id
                                            ? ' text-gray-900 dark:text-white border-b-2 border-blue-500'
                                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-blue-500'
                                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                                    >
                                        {tab.label}
                                    </Link>
                                ))}
                            </nav>
                        </div>
                        <div className="hidden sm:ml-6 sm:flex sm:items-center">
                            <span className="text-sm text-gray-700 dark:text-gray-300">Welcome, {userName}</span>
                            <button
                                type="button"
                                className="ml-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                onClick={() => {
                                    localStorage.clear();
                                    window.location.href = '/login';
                                }}
                            >
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {children}
            </main>
        </div>
    );
};

export default SystemOwnerLayout;
