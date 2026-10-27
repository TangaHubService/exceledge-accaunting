import { useState, useEffect } from 'react';
import { Building2, Loader2, Check, Package } from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { resolveLandingPath } from '../../lib/landingPage';

export default function SelectOrganization() {
    const [isClient, setIsClient] = useState(false);
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [loadingOrganizations, setLoadingOrganizations] = useState(true);
    const [selectedOrganizationId, setSelectedOrganizationId] = useState(null);
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
        toast[type](message, {
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
        });
    };

    useEffect(() => {
        setIsClient(true);
    }, []);

    useEffect(() => {
        const fetchOrganizations = async () => {
            try {
                setLoadingOrganizations(true);
                const data = await apiClient.getUserOrganizations();

                const orgs = Array.isArray(data) ? data : (data.organizations || []);
                setOrganizations(orgs);

                if ((data.organizations || data).length > 0 && !selectedOrganizationId) {
                    setSelectedOrganizationId((data.organizations || data)[0].id);
                }
            } catch (err: any) {
                console.error('Failed to load organizations:', err);
                setError(err.message);
            } finally {
                setLoadingOrganizations(false);
            }
        };

        if (isClient) {
            fetchOrganizations();
        }
    }, [isClient]);

    const handleSelectOrganization = (organization: any) => {
        setSelectedOrganizationId(organization.id);
    };

    const { login } = useAuth();
    const { setOrganization } = useOrganization();

    const handleContinue = async () => {
        if (!selectedOrganizationId) return;
        try {
            const response = await apiClient.switchOrganization({ organizationId: selectedOrganizationId });
            if (!response.organization) {
                throw new Error('Failed to switch organization');
            }

            if (response.token && response.user) {
                apiClient.setToken(response.token);
                login({
                    id: response.user.id,
                    email: response.user.email,
                    name: response.user.name,
                    token: response.token,
                    role: response.user.role,
                });
            }

            const selectedOrg = organizations.find((o: any) => String(o.id) === String(selectedOrganizationId));
            const orgData = {
                ...response.organization,
                role: selectedOrg?.role,
                isOwner: selectedOrg?.isOwner,
            };
            localStorage.setItem('current_organization_id', selectedOrganizationId || '');
            localStorage.setItem('organization', JSON.stringify(orgData));
            setOrganization(orgData);
            showToast('Organization switched successfully!', 'success');
            const landingPath = await resolveLandingPath(selectedOrganizationId as unknown as number);
            navigate(landingPath);
        } catch (err: any) {
            console.error('Failed to switch organization:', err);
            showToast('Failed to switch organization. Please try again.', 'error');
        }
    };

    const handleCreateNew = () => {
    };

    if (!isClient || loadingOrganizations) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    <span className="text-sm font-medium">Loading organizations...</span>
                </div>
            </div>
        );
    }

    return (
        <div
            className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat transition-all duration-500"
            style={{ backgroundImage: "url('/auth-bg.png')" }}
        >
            <div className="absolute inset-0 bg-blue-900/10 backdrop-blur-[2px]"></div>

            <div className="relative w-full max-w-[450px] mx-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                                <Package className="h-6 w-6 text-white" />
                            </div>
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                                Excledge
                            </h1>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            Select Organization
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                            Welcome back! Please select an organization to proceed.
                        </p>
                    </div>

                    <div className="p-6">

                        {organizations.length === 0 ? (
                            <div className="text-center py-6">
                                {error ? (
                                    <>
                                        <p className="text-xs text-red-600 mb-4 font-medium">Error: {error}</p>
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 transition-colors mr-2 text-xs font-semibold"
                                        >
                                            Retry
                                        </button>
                                    </>
                                ) : (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 font-medium">No organizations available.</p>
                                )}
                                <button
                                    onClick={handleCreateNew}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-semibold"
                                >
                                    + Create New Organization
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-3">
                                    {organizations.map((org: any) => (
                                        <div
                                            key={org.id}
                                            className={`relative p-4 border rounded-lg cursor-pointer transition-colors ${selectedOrganizationId === org.id
                                                ? 'border-blue-600 bg-blue-50'
                                                : 'border-gray-200 hover:bg-gray-50'
                                                }`}
                                            onClick={() => handleSelectOrganization(org)}
                                        >
                                            <div className="flex items-center">
                                                <div
                                                    className={`flex items-center justify-center h-4 w-4 rounded-full border mr-3 transition-colors ${selectedOrganizationId === org.id
                                                        ? 'bg-blue-600 border-blue-600'
                                                        : 'border-gray-300 dark:border-gray-600'
                                                        }`}
                                                >
                                                    {selectedOrganizationId === org.id && (
                                                        <Check className="h-2.5 w-2.5 text-white" />
                                                    )}
                                                </div>
                                                <Building2
                                                    className={`h-4 w-4 mr-3 transition-colors ${selectedOrganizationId === org.id
                                                        ? 'text-blue-600'
                                                        : 'text-gray-400'
                                                        }`}
                                                />
                                                <div className="text-left">
                                                    <p
                                                        className={`font-semibold transition-colors ${selectedOrganizationId === org.id
                                                            ? 'text-blue-600'
                                                            : 'text-gray-900 dark:text-white'
                                                            }`}
                                                    >
                                                        {org.name}
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{org.address}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    className="w-full mt-6 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                    onClick={handleContinue}
                                    disabled={!selectedOrganizationId}
                                >
                                    Continue
                                </button>

                                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
                                    <button
                                        className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                        onClick={handleCreateNew}
                                    >
                                        + Add New Organization
                                    </button>
                                </div>
                            </>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
}