import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import { useOrganization } from '../context/OrganizationContext';
import { useTranslation } from 'react-i18next';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select';

interface Organization {
    id: number;
    name: string;
    businessType: string;
    role: string;
    isOwner: boolean;
}

export const OrganizationSwitcher: React.FC<{ toolbar?: boolean }> = ({ toolbar = false }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { login, refreshUserProfile } = useAuth();
    const { organization, setOrganization } = useOrganization();
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(false);
    const [switching, setSwitching] = useState(false);

    useEffect(() => {
        const fetchOrganizations = async () => {
            try {
                setLoading(true);
                const data = await apiClient.getUserOrganizations();
                const orgs = Array.isArray(data) ? data : (data.organizations || []);
                setOrganizations(orgs);
            } catch (err) {
                console.error('Failed to load organizations:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchOrganizations();
    }, []);

    const handleSelectOrganization = async (orgId: string) => {
        const selectedOrg = organizations.find(o => String(o.id) === orgId);
        if (!selectedOrg || String(selectedOrg.id) === String(organization?.id)) return;

        try {
            setSwitching(true);

            // Clear branch selection to force recalculation for the new organization
            localStorage.removeItem('branch_scope');
            localStorage.removeItem('selected_branch_ids');

            const response = await apiClient.switchOrganization({ organizationId: selectedOrg.id });

            if (response.organization && response.token && response.user) {
                localStorage.setItem('current_organization_id', String(selectedOrg.id));
                localStorage.setItem('organization', JSON.stringify({
                    ...response.organization,
                    role: selectedOrg.role,
                    isOwner: selectedOrg.isOwner,
                }));

                setOrganization({
                    id: response.organization.id,
                    name: response.organization.name,
                    businessType: response.organization.businessType,
                    address: response.organization.address,
                    phone: response.organization.phone,
                    email: response.organization.email,
                    avatar: response.organization.avatar,
                    hasActiveSubscription: response.organization.hasActiveSubscription,
                    role: selectedOrg.role,
                    isOwner: selectedOrg.isOwner,
                });

                // Update auth context with new token/user
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

                // Refresh the page to clear states or navigate to dashboard
                if (window.location.pathname.startsWith('/dashboard')) {
                    navigate('/dashboard', { replace: true });
                    window.location.reload();
                } else {
                    navigate('/dashboard');
                }
            }
        } catch (err) {
            console.error('Failed to switch organization:', err);
        } finally {
            setSwitching(false);
        }
    };

    if (loading && organizations.length === 0) {
        return (
            <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                    toolbar
                        ? 'border-white/15 bg-white/10 text-slate-200'
                        : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800'
                }`}
            >
                <Loader2 className={`h-4 w-4 animate-spin ${toolbar ? 'text-white' : 'text-blue-600'}`} />
                <span>{t('common.loading')}</span>
            </div>
        );
    }

    if (organizations.length <= 1 && !organization) return null;

    return (
        <div className="flex items-center gap-2">
            <Select
                value={organization?.id?.toString()}
                onValueChange={handleSelectOrganization}
                disabled={switching}
            >
                <SelectTrigger
                    className={`h-9 w-[180px] text-sm font-medium transition-all focus:ring-2 focus:ring-white/40 ${
                        toolbar
                            ? 'border-white/25 bg-white/10 text-white hover:bg-white/15'
                            : 'border-gray-200 bg-white/50 hover:bg-white dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800'
                    }`}
                >
                    <div className="flex items-center gap-2 truncate">
                        <Building2 className={`h-4 w-4 shrink-0 ${toolbar ? 'text-slate-300' : 'text-gray-500'}`} />
                        <SelectValue placeholder={t('organizations.select')} />
                    </div>
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                    {organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id.toString()} className="text-sm">
                            <div className="flex items-center justify-between w-full gap-2">
                                <span className="truncate">{org.name}</span>
                                {String(org.id) === String(organization?.id) && (
                                    <Check className="h-3 w-3 text-blue-600" />
                                )}
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {switching && (
                <Loader2 className={`h-4 w-4 animate-spin ${toolbar ? 'text-white' : 'text-blue-600'}`} />
            )}
        </div>
    );
};
