import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Loader2, Check, Settings } from 'lucide-react';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../context/AuthContext';
import { useOrganization } from '../../../context/OrganizationContext';
import { useSubscription } from '../../../context/SubscriptionContext';
import { PricingCard } from '../../../components/landing/PricingCard';
import CreateOrganizationModal from '../../../components/CreateOrganizationModal';
import { useTranslation } from 'react-i18next';

interface Organization {
  id: number;
  name: string;
  businessType: string;
  address?: string;
  phone?: string;
  email?: string;
  role: string;
  isOwner: boolean;
  hasActiveSubscription?: boolean;
  subscriptionStatus?: string | null;
  subscriptionEndDate?: string | null;
}

export default function OrganizationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, login, refreshUserProfile } = useAuth();
  const { organization, setOrganization } = useOrganization();
  const { plans, isLoading: plansLoading } = useSubscription();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasOrganization = organization !== null || localStorage.getItem('current_organization_id') !== null;
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        setLoading(true);
        setError(null);

        // If user is authenticated, fetch their organizations
        const data = await apiClient.getUserOrganizations();
        const orgs = Array.isArray(data) ? data : (data.organizations || []);
        setOrganizations(orgs);
      } catch (err: any) {
        console.error('Failed to load organizations:', err);
        setError(err.message || 'Failed to load organizations');
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizations();
  }, []);

  const handleSelectOrganization = async (org: Organization) => {
    try {
      const response = await apiClient.switchOrganization({ organizationId: org.id });
      if (response.organization && response.token && response.user) {
        localStorage.setItem('current_organization_id', String(org.id));
        localStorage.setItem('organization', JSON.stringify(response.organization));
        setOrganization({
          id: response.organization.id,
          name: response.organization.name,
          businessType: response.organization.businessType,
          address: response.organization.address,
          phone: response.organization.phone,
          email: response.organization.email,
        });

        // Update auth context with new token/user if provided
        if (response.token && response.user) {
          apiClient.setToken(response.token);
          localStorage.setItem('token', response.token);

          login({
            id: String(response.user.id),
            email: response.user.email,
            name: response.user.name,
            token: response.token,
            role: response.user.role,
          });

          await refreshUserProfile();
        }

        return true;
      }
      return false;
    } catch (err: any) {
      console.error('Failed to switch organization:', err);
      setError(err.message || 'Failed to switch organization');
      return false;
    }
  };

  const onSelectOrg = async (org: Organization) => {
    const currentOrgId = organization?.id || localStorage.getItem('current_organization_id');
    if (String(org.id) === String(currentOrgId)) {
      navigate('/dashboard');
      return;
    }

    const success = await handleSelectOrganization(org);
    if (success) {
      navigate('/dashboard');
    }
  };

  const handleConfigure = async (e: React.MouseEvent, org: Organization) => {
    e.stopPropagation();
    const success = await handleSelectOrganization(org);
    if (success) {
      navigate('/dashboard/organization-config');
    }
  };

  const handleCreateSuccess = async () => {
    setIsCreateModalOpen(false);
    await refreshUserProfile();
    try {
      const data = await apiClient.getUserOrganizations();
      const orgs = Array.isArray(data) ? data : (data.organizations || []);
      setOrganizations(orgs);
    } catch (err) {
      console.error('Failed to refresh organizations:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          <p className="text-sm text-gray-500 font-medium">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // If user has no organization, show enhanced onboarding state
  if (!hasOrganization && organizations.length === 0) {
    return (
      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Welcome Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 mb-6 group hover:scale-110 transition-transform duration-300">
            <Building2 size={48} className="transition-transform group-hover:rotate-12" />
          </div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-4">
            {t('organizations.welcomeTitle')}
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
            {t('organizations.welcomeDesc')}
          </p>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:shadow-blue-500/30 hover:scale-105 active:scale-95"
          >
            <Plus className="h-5 w-5" />
            {t('organizations.createOrganization')}
          </button>
        </div>

        <div className="space-y-8 rounded-2xl bg-[#f2f4f7] px-4 py-10 dark:bg-zinc-950 sm:px-8 sm:py-12">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              {t('subscription.choosePlan')}
            </h2>
            <p className="text-base text-gray-600 dark:text-zinc-400 sm:text-lg">
              {t('subscription.planDesc')}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {[t('subscription.trustSecure'), t('subscription.trustSupport'), t('subscription.trustActivate')].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {plansLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {plans.slice(1).map((plan: any, index: number) => (
                <PricingCard
                  key={plan.id}
                  title={plan.name}
                  price={plan.price.toLocaleString()}
                  period={plan.billingCycle}
                  features={plan.features.map((f: any) => f.name)}
                  popular={index === 1}
                  onSelect={() => setIsCreateModalOpen(true)}
                />
              ))}
            </div>
          )}
          <p className="text-center text-sm text-gray-500 dark:text-zinc-500">
            {t('subscription.plansFootnote')}
          </p>
        </div>

        <CreateOrganizationModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handleCreateSuccess}
        />
      </div>
    );
  }

  // If admin has organizations, show list
  if (isAdmin && organizations.length > 0) {
    const currentOrgId = organization?.id || localStorage.getItem('current_organization_id');

    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t('organizations.myOrganizations') || 'My Organizations'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t('organizations.selectOrCreate') || 'Select an organization or create a new one'}
              </p>
            </div>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t('organizations.createNew') || 'Create New'}
            </button>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {organizations.map((org) => {
              const isCurrent = String(org.id) === String(currentOrgId);
              return (
                <div
                  key={org.id}
                  onClick={() => onSelectOrg(org)}
                  className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-2 transition-all cursor-pointer hover:shadow-md group/card ${isCurrent
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                    }`}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                          <Building2 className="h-6 w-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                            {org.name}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {org.businessType.replace('_', ' ')}
                          </p>
                        </div>
                      </div>
                      {isCurrent && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-medium">
                          <Check className="h-3 w-3" />
                          {t('organizations.current') || 'Current'}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {org.address && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                          📍 {org.address}
                        </p>
                      )}
                      {org.phone && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          📞 {org.phone}
                        </p>
                      )}
                      {org.email && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                          ✉️ {org.email}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {t('organizations.role') || 'Role'}: {org.role}
                        </span>
                        {org.isOwner && (
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            {t('organizations.owner') || 'Owner'}
                          </span>
                        )}
                      </div>

                      {(org.role === 'ADMIN' || org.isOwner) && (
                        <button
                          onClick={(e) => handleConfigure(e, org)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors group"
                          title={t('common.configure') || 'Configure'}
                        >
                          <Settings className="h-4 w-4 group-hover:rotate-45 transition-transform" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <CreateOrganizationModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handleCreateSuccess}
        />
      </div>
    );
  }

  // Fallback
  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <p className="text-gray-600 dark:text-gray-400">
              {t('organizations.noOrganizations') || 'No organizations found'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
