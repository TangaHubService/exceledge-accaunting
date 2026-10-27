import React from 'react';
import { Users, Building2, DollarSign, CheckCircle, XCircle } from 'lucide-react';

interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  color: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, title, value, color }) => (
  <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-gray-700">
    <div className="p-5">
      <div className="flex items-center">
        <div className={`flex-shrink-0 rounded-md p-3 ${color}`}>
          {icon}
        </div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{title}</dt>
            <dd>
              <div className="text-lg font-medium text-gray-900 dark:text-white">{value}</div>
            </dd>
          </dl>
        </div>
      </div>
    </div>
  </div>
);

interface OverviewProps {
  stats: {
    totalOrganizations: number;
    activeSubscriptions: number;
    totalRevenue: number;
    pendingPayments: number;
    totalUsers: number;
  };
  recentOrganizations: Array<{
    id: string;
    name: string;
    businessType: string;
    owner: string;
    ownerEmail: string;
    isActive: boolean;
    createdAt: string;
    subscription: any;
  }>;
  isLoading?: boolean;
  error?: string;
}

const Overview: React.FC<OverviewProps> = ({ stats, recentOrganizations }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Dashboard Overview</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Welcome back! Here's what's happening with your system.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<Building2 className="h-6 w-6 text-white" />}
          title="Total Organizations"
          value={stats.totalOrganizations}
          color="bg-blue-500"
        />
        <StatCard
          icon={<Users className="h-6 w-6 text-white" />}
          title="Total Users"
          value={stats.totalUsers}
          color="bg-blue-500"
        />
        <StatCard
          icon={<CheckCircle className="h-6 w-6 text-white" />}
          title="Active Subscriptions"
          value={stats.activeSubscriptions}
          color="bg-green-500"
        />
        <StatCard
          icon={<DollarSign className="h-6 w-6 text-white" />}
          title="Total Revenue"
          value={`RWF ${stats.totalRevenue.toLocaleString()}`}
          color="bg-purple-500"
        />
        <StatCard
          icon={<XCircle className="h-6 w-6 text-white" />}
          title="Pending Payments"
          value={stats.pendingPayments}
          color="bg-yellow-500"
        />
      </div>

      {/* Recent Organizations Section */}
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-5 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">Recent Organizations</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">Latest organizations added to your system.</p>
        </div>
        <div className="border-t border-gray-200 dark:border-gray-700">
          {recentOrganizations.length === 0 ? (
            <div className="px-4 py-5 sm:p-6">
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">No recent organizations</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {recentOrganizations.map((org) => (
                <li key={org.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{org.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{org.businessType}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Owner: {org.owner} ({org.ownerEmail})
                      </p>
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      {org.subscription ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {org.subscription.status}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-400">
                          No subscription
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default Overview;
