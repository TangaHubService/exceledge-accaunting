import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Building2,
    MapPin,
    Plus,
    Edit,
    Loader2,
    Save,
    Info,
    GitBranch,
    ShieldCheck,
    Calendar,
    Activity,
    Phone,
    Mail,
    Fingerprint,
    Star,
    Settings as SettingsIcon,
    LayoutGrid,
    ToggleLeft,
    SlidersHorizontal,
    ChevronDown,
    FlaskConical
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerDescription } from '../../../components/ui/drawer';
import { Badge } from '../../../components/ui/badge';
import { Switch } from '../../../components/ui/switch';
import { AppToggle } from '../../../components/ui/AppToggle';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import PhoneInputWithCountryCode from '../../../components/PhoneInputWithCountryCode';
import { apiClient } from '../../../lib/api-client';
import { cn } from '../../../lib/utils';
import { toast } from 'react-toastify';
import { useAuth } from '../../../context/AuthContext';
import { useOrganization } from '../../../context/OrganizationContext';
import { useOrganizationSettings } from '../../../context/OrganizationSettingsContext';
import { useBranch } from '../../../context/BranchContext';
import { SIDEBAR_SECTIONS } from '../../../types/organizationSettings';
import type {
    ISidebarConfig,
    IFeatureFlags,
    IPreferences,
    IOrganizationSettings,
} from '../../../types/organizationSettings';

type OrganizationData = {
    id: number;
    name: string;
    address: string;
    phone?: string;
    email?: string;
    TIN?: string;
    VRN?: string;
    vatRegistered?: boolean;
    isTaxExempt?: boolean;
    taxExemptionReason?: string | null;
    ebmDeviceId?: string | null;
    ebmSerialNo?: string | null;
    mrcNo?: string | null;
    trainingMode?: boolean;
    currency?: string;
    isActive: boolean;
    createdAt: string;
    avatar?: string;
};

interface Branch {
    id: number;
    name: string;
    code: string;
    address?: string;
    location?: string;
    status: 'ACTIVE' | 'INACTIVE';
    isDefault?: boolean;
}

const FEATURE_FLAG_LABELS: Record<keyof IFeatureFlags, { label: string; description: string }> = {
    allowNegativeStock: {
        label: 'Allow Negative Stock',
        description: "Let sales proceed even when there isn't enough stock on hand.",
    },
    ebmIntegrationEnabled: {
        label: 'RRA EBM Integration',
        description: 'Push completed sales to the RRA EBM/VSDC electronic invoicing system.',
    },
    requireStockAdjustmentApproval: {
        label: 'Require Stock Adjustment Approval',
        description: 'A manager must approve stock adjustments before they take effect.',
    },
    allowManualDiscounts: {
        label: 'Allow Manual Discounts',
        description: 'Let sellers apply ad-hoc discounts at checkout without manager override.',
    },
    stockTransfersEnabled: {
        label: 'Stock Transfers',
        description: 'Enable transferring stock between branches.',
    },
};

const LANGUAGE_OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'rw', label: 'Kinyarwanda' },
    { value: 'fr', label: 'Français' },
    { value: 'sw', label: 'Kiswahili' },
];

const DATE_FORMAT_OPTIONS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

// Two rows at the widest (3-column) grid layout — sections with more items
// than this collapse behind a "Show more" toggle instead of growing tall.
const VISIBLE_ITEMS_CAP = 6;

export function OrganizationConfig() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { setOrganization: updateGlobalOrg } = useOrganization();
    const { refreshSettings } = useOrganizationSettings();
    const { refreshBranches } = useBranch();

    const [organization, setOrganization] = useState<OrganizationData | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSavingOrg, setIsSavingOrg] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
    const [settings, setSettings] = useState<IOrganizationSettings | null>(null);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

    // Branch dialog state
    const [branchDialogOpen, setBranchDialogOpen] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [togglingBranchId, setTogglingBranchId] = useState<number | null>(null);
    const [branchFormData, setBranchFormData] = useState({
        name: '',
        code: '',
        address: '',
        location: '',
        status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE'
    });

    const isAuthorized = user?.role === 'ADMIN' || user?.role === 'SYSTEM_OWNER';

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const orgId = localStorage.getItem('current_organization_id');
            if (orgId) {
                const [orgResponse, branchesResponse, settingsResponse] = await Promise.all([
                    apiClient.getOrganization(orgId),
                    apiClient.getBranches(true),
                    apiClient.getOrganizationSettings(orgId)
                ]);

                if (orgResponse?.organization) {
                    setOrganization(orgResponse.organization);
                }
                setBranches(branchesResponse || []);
                if (settingsResponse?.settings) {
                    setSettings(settingsResponse.settings);
                }
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to fetch settings');
        } finally {
            setLoading(false);
        }
    };

    const mrcErrorMessage = (error: any): string | null =>
        error?.response?.data?.code === 'INVALID_MRC_FORMAT' ? t('companySettings.mrcInvalid') : null;

    const handleOrgSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!organization || !isAuthorized) return;
        const mrc = (organization.mrcNo ?? '').trim();
        if (mrc && !/^[A-Za-z0-9]{11}$/.test(mrc)) {
            toast.error(t('companySettings.mrcInvalid'));
            return;
        }

        setIsSavingOrg(true);
        try {
            const response = await apiClient.updateOrganization(organization);
            updateGlobalOrg(organization as any);
            toast.success(response.message || t('companySettings.updateSuccess'));
        } catch (error: any) {
            toast.error(mrcErrorMessage(error) || error.message || t('companySettings.updateError'));
        } finally {
            setIsSavingOrg(false);
        }
    };

    const handleAvatarUpload = async (file: File) => {
        if (!file || !isAuthorized) return;

        // Check file type
        if (!file.type.match('image.*')) {
            toast.error(t('companySettings.imageOnly') || 'Please select an image file');
            return;
        }

        // Check file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            toast.error(t('companySettings.fileSizeError') || 'File size must be less than 5MB');
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('avatar', file);

            // Create preview
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewAvatar(reader.result as string);
            };
            reader.readAsDataURL(file);

            // Upload to server
            await apiClient.uploadAvatar(formData);
            toast.success(t('companySettings.avatarSuccess') || 'Logo updated successfully');
            fetchData();
        } catch (error: any) {
            toast.error(error.message || t('companySettings.avatarError') || 'Failed to upload logo');
        } finally {
            setIsUploading(false);
        }
    };

    const handleBranchCreate = () => {
        setEditingBranch(null);
        setBranchFormData({
            name: '',
            code: '',
            address: '',
            location: '',
            status: 'ACTIVE'
        });
        setBranchDialogOpen(true);
    };

    const handleBranchEdit = (branch: Branch) => {
        setEditingBranch(branch);
        setBranchFormData({
            name: branch.name,
            code: branch.code,
            address: branch.address || '',
            location: branch.location || '',
            status: branch.status
        });
        setBranchDialogOpen(true);
    };

    const handleBranchSave = async () => {
        try {
            if (editingBranch) {
                await apiClient.updateBranch(editingBranch.id, branchFormData);
                toast.success(t('branches.updated') || 'Branch updated');
            } else {
                await apiClient.createBranch(branchFormData);
                toast.success(t('branches.created') || 'Branch created');
            }
            setBranchDialogOpen(false);
            fetchData();
            refreshBranches();
        } catch (error: any) {
            toast.error(
              error?.response?.data?.error ||
                error?.response?.data?.message ||
                error.message ||
                'Failed to save branch',
            );
        }
    };

    const handleBranchToggleStatus = async (branch: Branch) => {
        const newStatus = branch.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        setTogglingBranchId(branch.id);
        try {
            await apiClient.updateBranch(branch.id, { status: newStatus });
            toast.success(`Branch ${newStatus === 'ACTIVE' ? 'activated' : 'deactivated'} successfully`);
            await fetchData();
            refreshBranches();
        } catch (error: any) {
            toast.error(
              error?.response?.data?.error ||
                error?.response?.data?.message ||
                error.message ||
                'Failed to update branch status',
            );
        } finally {
            setTogglingBranchId(null);
        }
    };

    const handleSetDefaultBranch = async (branch: Branch) => {
        try {
            await apiClient.setDefaultBranch(branch.id);
            toast.success(t('branches.setDefault') || 'Default branch updated');
            fetchData();
            refreshBranches();
        } catch (error: any) {
            toast.error(error.message || 'Failed to set default branch');
        }
    };

    const toggleSidebarModule = (key: keyof ISidebarConfig) => {
        if (!isAuthorized) return;
        setSettings(prev => prev ? { ...prev, sidebarConfig: { ...prev.sidebarConfig, [key]: !prev.sidebarConfig[key] } } : prev);
    };

    const setSidebarSection = (keys: (keyof ISidebarConfig)[], value: boolean) => {
        if (!isAuthorized) return;
        setSettings(prev => {
            if (!prev) return prev;
            const patch = Object.fromEntries(keys.map(key => [key, value])) as Partial<ISidebarConfig>;
            return { ...prev, sidebarConfig: { ...prev.sidebarConfig, ...patch } };
        });
    };

    const toggleFeatureFlag = (key: keyof IFeatureFlags) => {
        if (!isAuthorized) return;
        setSettings(prev => prev ? { ...prev, featureFlags: { ...prev.featureFlags, [key]: !prev.featureFlags[key] } } : prev);
    };

    const updatePreference = <K extends keyof IPreferences>(key: K, value: IPreferences[K]) => {
        if (!isAuthorized) return;
        setSettings(prev => prev ? { ...prev, preferences: { ...prev.preferences, [key]: value } } : prev);
    };

    const handleSettingsSave = async () => {
        if (!settings || !isAuthorized) return;
        const orgId = localStorage.getItem('current_organization_id');
        if (!orgId) return;

        setIsSavingSettings(true);
        try {
            const response = await apiClient.updateOrganizationSettings(orgId, settings);
            if (response?.settings) {
                setSettings(response.settings);
            }
            await refreshSettings();
            toast.success('Organization settings updated');
        } catch (error: any) {
            toast.error(mrcErrorMessage(error) || error.message || 'Failed to update organization settings');
        } finally {
            setIsSavingSettings(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[400px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                    {t('nav.organizationConfig')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400">
                    Manage your organization profile, contact information, and business branches.
                </p>
            </div>

            <Tabs defaultValue="details" className="w-full">
                <TabsList className="grid w-full grid-cols-3 lg:w-[560px] bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                    <TabsTrigger value="details" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm">
                        <Building2 className="h-4 w-4 mr-2" />
                        Details
                    </TabsTrigger>
                    <TabsTrigger value="branches" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm">
                        <GitBranch className="h-4 w-4 mr-2" />
                        Branches
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm">
                        <SettingsIcon className="h-4 w-4 mr-2" />
                        Settings
                    </TabsTrigger>
                </TabsList>

                {/* Organization Details Tab */}
                <TabsContent value="details" className="mt-6">
                    <Card className="border-none shadow-xl bg-white dark:bg-gray-800 overflow-hidden">
                        <CardHeader className="bg-gradient-to-r from-blue-600/5 to-indigo-600/5 border-b border-gray-100 dark:border-gray-700">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Info className="h-5 w-5 text-blue-600" />
                                        <CardTitle>Organization Profile</CardTitle>
                                    </div>
                                    <CardDescription>
                                        Basic information about your business entity.
                                    </CardDescription>
                                </div>
                                <div className="relative group">
                                    <div className="h-20 w-20 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-200 dark:border-gray-600 group-hover:border-blue-400 transition-colors">
                                        {previewAvatar || organization?.avatar ? (
                                            <img
                                                src={previewAvatar || organization?.avatar}
                                                alt="Organization logo"
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <Building2 className="h-8 w-8 text-gray-400" />
                                        )}
                                    </div>
                                    {isAuthorized && (
                                        <label className="absolute -bottom-2 -right-2 bg-blue-600 text-white p-1.5 rounded-lg cursor-pointer hover:bg-blue-700 transition-colors shadow-lg border-2 border-white dark:border-gray-800">
                                            {isUploading ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Plus className="h-3 w-3" />
                                            )}
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={(e) => e.target.files?.[0] && handleAvatarUpload(e.target.files[0])}
                                                disabled={isUploading}
                                            />
                                        </label>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <form onSubmit={handleOrgSubmit} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Building2 className="h-4 w-4 text-gray-400" />
                                            Organization Name
                                        </Label>
                                        <Input
                                            value={organization?.name || ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, name: e.target.value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            className="rounded-xl"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Fingerprint className="h-4 w-4 text-gray-400" />
                                            Organization Code / TIN
                                        </Label>
                                        <Input
                                            value={organization?.TIN || ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, TIN: e.target.value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            className="rounded-xl"
                                        />
                                    </div>

                                    <div className="space-y-2 md:col-span-2">
                                        <div className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-4 py-3">
                                            <div>
                                                <Label className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                                                    <ShieldCheck className="h-4 w-4 text-gray-400" />
                                                    VAT Registered
                                                </Label>
                                                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                                    When off, every sale uses RRA tax code D (not VAT registered).
                                                    When on, each product's tax category (A/B/C) applies.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={organization?.vatRegistered ?? true}
                                                onCheckedChange={(checked) => setOrganization(prev => prev ? { ...prev, vatRegistered: checked } : null)}
                                                disabled={!isAuthorized || isSavingOrg}
                                            />
                                        </div>
                                    </div>

                                    {organization?.vatRegistered && (
                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-2">
                                                <ShieldCheck className="h-4 w-4 text-gray-400" />
                                                VAT Registration Number (VRN)
                                            </Label>
                                            <Input
                                                value={organization?.VRN || ''}
                                                onChange={(e) => setOrganization(prev => prev ? { ...prev, VRN: e.target.value } : null)}
                                                disabled={!isAuthorized || isSavingOrg}
                                                placeholder="e.g. VRN-100123456"
                                                className="rounded-xl"
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-2 md:col-span-2">
                                        <div className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-4 py-3">
                                            <div>
                                                <Label className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                                                    <ShieldCheck className="h-4 w-4 text-gray-400" />
                                                    Tax Exempt Entity
                                                </Label>
                                                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                                    For legally tax-exempt organizations (e.g. NGO, diplomatic mission).
                                                    When on, every sale uses RRA tax code A (VAT exempt), regardless of
                                                    VAT-registration status or product tax category.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={organization?.isTaxExempt ?? false}
                                                onCheckedChange={(checked) => setOrganization(prev => prev ? { ...prev, isTaxExempt: checked } : null)}
                                                disabled={!isAuthorized || isSavingOrg}
                                            />
                                        </div>
                                    </div>

                                    {organization?.isTaxExempt && (
                                        <div className="space-y-2 md:col-span-2">
                                            <Label className="flex items-center gap-2">
                                                <ShieldCheck className="h-4 w-4 text-gray-400" />
                                                Exemption Reason / Certificate Reference
                                            </Label>
                                            <Input
                                                value={organization?.taxExemptionReason || ''}
                                                onChange={(e) => setOrganization(prev => prev ? { ...prev, taxExemptionReason: e.target.value } : null)}
                                                disabled={!isAuthorized || isSavingOrg}
                                                placeholder="e.g. NGO exemption certificate #123"
                                                className="rounded-xl"
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-2 md:col-span-2">
                                        <Label className="flex items-center gap-2">
                                            <ShieldCheck className="h-4 w-4 text-gray-400" />
                                            RRA tax bands
                                        </Label>
                                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                                            {[
                                                { code: 'A', rate: '0%', label: 'Exempt' },
                                                { code: 'B', rate: '18%', label: 'Standard VAT' },
                                                { code: 'C', rate: '0%', label: 'Zero-rated / export' },
                                                { code: 'D', rate: '0%', label: 'Non-taxable (not VAT registered)' },
                                            ].map((b) => (
                                                <div key={b.code} className="flex items-center justify-between px-3 py-2">
                                                    <span><span className="font-semibold">{b.code}</span> — {b.label}</span>
                                                    <span className="font-mono tabular-nums">{b.rate}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-xs text-gray-400">
                                            Tax rates are fixed by Rwandan tax law and applied automatically per product tax code.
                                            They are not operator-editable; a rate change would require a system update and RRA re-certification.
                                        </p>
                                    </div>

                                    <div className="space-y-2 md:col-span-2">
                                        <Label className="flex items-center gap-2">
                                            <ShieldCheck className="h-4 w-4 text-gray-400" />
                                            RRA EBM / VSDC — device ID
                                        </Label>
                                        <Input
                                            value={organization?.ebmDeviceId ?? ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, ebmDeviceId: e.target.value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            placeholder="From RRA registration (VSDC)"
                                            className="rounded-xl"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <ShieldCheck className="h-4 w-4 text-gray-400" />
                                            RRA EBM / VSDC — device serial (dvcSrlNo)
                                        </Label>
                                        <Input
                                            value={organization?.ebmSerialNo ?? ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, ebmSerialNo: e.target.value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            placeholder="Device / controller serial from RRA"
                                            className="rounded-xl font-mono"
                                            maxLength={32}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <ShieldCheck className="h-4 w-4 text-gray-400" />
                                            MRC (Machine Registration Code)
                                        </Label>
                                        <Input
                                            value={organization?.mrcNo ?? ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, mrcNo: e.target.value.toUpperCase() } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            placeholder="e.g. WIS01029467"
                                            className="rounded-xl font-mono"
                                            minLength={11}
                                            maxLength={11}
                                        />
                                        <p className="text-xs text-gray-400">{t('companySettings.mrcHint')}</p>
                                    </div>

                                    <div className="space-y-2 md:col-span-2">
                                        <div className="flex items-center justify-between rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
                                            <div>
                                                <Label className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                                                    <FlaskConical className="h-4 w-4 text-amber-500" />
                                                    Training Mode
                                                </Label>
                                                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                                                    For staff practice only. While on, every sale prints as a Training
                                                    Sale (TS) and only TS receipts can be refunded (as TR). They go to
                                                    VSDC as training documents (no signature), print watermarked "not
                                                    an official receipt", and never change stock, payments, customer
                                                    balances, accounting or sales reports. Turn off before real business hours.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={organization?.trainingMode ?? false}
                                                onCheckedChange={(checked) => setOrganization(prev => prev ? { ...prev, trainingMode: checked } : null)}
                                                disabled={!isAuthorized || isSavingOrg}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Mail className="h-4 w-4 text-gray-400" />
                                            Email Address
                                        </Label>
                                        <Input
                                            type="email"
                                            value={organization?.email || ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, email: e.target.value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            className="rounded-xl"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Phone className="h-4 w-4 text-gray-400" />
                                            Contact Phone
                                        </Label>
                                        <PhoneInputWithCountryCode
                                            value={organization?.phone || ''}
                                            onChange={(value: string) => setOrganization(prev => prev ? { ...prev, phone: value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            className="rounded-xl"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <MapPin className="h-4 w-4 text-gray-400" />
                                            Headquarters Address
                                        </Label>
                                        <Input
                                            value={organization?.address || ''}
                                            onChange={(e) => setOrganization(prev => prev ? { ...prev, address: e.target.value } : null)}
                                            disabled={!isAuthorized || isSavingOrg}
                                            className="rounded-xl"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Activity className="h-4 w-4 text-gray-400" />
                                            Status
                                        </Label>
                                        <div className="flex items-center h-10 px-3 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700">
                                            <Badge variant={organization?.isActive ? "default" : "destructive"} className="rounded-full">
                                                {organization?.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Calendar className="h-4 w-4 text-gray-400" />
                                            Created On
                                        </Label>
                                        <Input
                                            value={organization?.createdAt ? new Date(organization.createdAt).toLocaleDateString() : 'N/A'}
                                            disabled
                                            className="rounded-xl bg-gray-50 dark:bg-gray-900 grayscale opacity-60"
                                        />
                                    </div>
                                </div>

                                {isAuthorized && (
                                    <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-gray-700">
                                        <Button
                                            type="submit"
                                            disabled={isSavingOrg}
                                            className="bg-blue-600 hover:bg-blue-700 text-white px-8 rounded-xl shadow-lg shadow-blue-500/20"
                                        >
                                            {isSavingOrg ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                            Save Changes
                                        </Button>
                                    </div>
                                )}
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Branch Management Tab */}
                <TabsContent value="branches" className="mt-6">
                    <Card className="border-none shadow-xl bg-white dark:bg-gray-800">
                        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-indigo-600/5 to-purple-600/5">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <GitBranch className="h-5 w-5 text-indigo-600" />
                                    Business Branches
                                </CardTitle>
                                <CardDescription>
                                    Logical units for branch-aware reporting and data management.
                                </CardDescription>
                            </div>
                            {isAuthorized && (
                                <Button onClick={handleBranchCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl">
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add Branch
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-gray-50/50 dark:bg-gray-900/50">
                                    <TableRow>
                                        <TableHead className="pl-6">Name</TableHead>
                                        <TableHead>Code</TableHead>
                                        <TableHead>Location</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right pr-6">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {branches.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-12 text-gray-500">
                                                No branches found for this organization.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        branches.map((branch) => (
                                            <TableRow key={branch.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/30 transition-colors">
                                                <TableCell className="font-medium pl-6">
                                                    <div className="flex items-center gap-2">
                                                        {branch.name}
                                                        {branch.isDefault && (
                                                            <Badge variant="outline" className="rounded-full text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                                                                Default
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                                        {branch.code}
                                                    </code>
                                                </TableCell>
                                                <TableCell>{branch.location || 'Not specified'}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <AppToggle
                                                            checked={branch.status === 'ACTIVE'}
                                                            onChange={() => handleBranchToggleStatus(branch)}
                                                            loading={togglingBranchId === branch.id}
                                                            disabled={!isAuthorized}
                                                            size="small"
                                                            aria-label={branch.status === 'ACTIVE' ? 'Deactivate branch' : 'Activate branch'}
                                                        />
                                                        <Badge
                                                            variant={branch.status === 'ACTIVE' ? "default" : "outline"}
                                                            className="rounded-full"
                                                        >
                                                            {branch.status}
                                                        </Badge>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <div className="flex justify-end gap-2">
                                                        {isAuthorized && (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleSetDefaultBranch(branch)}
                                                                    disabled={branch.isDefault || branch.status !== 'ACTIVE'}
                                                                    title={branch.isDefault ? 'Default branch' : 'Set as Default'}
                                                                    className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-100"
                                                                >
                                                                    <Star className={cn('h-4 w-4', branch.isDefault && 'fill-amber-500')} />
                                                                </Button>
                                                                <Button variant="ghost" size="sm" onClick={() => handleBranchEdit(branch)} className="text-blue-600 hover:bg-blue-50">
                                                                    <Edit className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Organization Settings Tab */}
                <TabsContent value="settings" className="mt-6 space-y-6">
                    {!settings ? (
                        <div className="flex h-[200px] items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                        </div>
                    ) : (
                        <>
                            <Card className="border-none shadow-xl bg-white dark:bg-gray-800 overflow-hidden">
                                <CardHeader className="border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-blue-600/5 to-indigo-600/5">
                                    <div className="flex items-center gap-2">
                                        <LayoutGrid className="h-5 w-5 text-blue-600" />
                                        <CardTitle>Sidebar Modules</CardTitle>
                                    </div>
                                    <CardDescription>
                                        Choose which sections appear in the navigation for this workspace.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6">
                                    {SIDEBAR_SECTIONS.map((section) => {
                                        const sectionKeys = section.items.map(i => i.key);
                                        const allOn = sectionKeys.every(key => settings.sidebarConfig[key]);
                                        const isExpanded = expandedSections[section.label] ?? false;
                                        const hasMore = section.items.length > VISIBLE_ITEMS_CAP;
                                        const visibleItems = isExpanded ? section.items : section.items.slice(0, VISIBLE_ITEMS_CAP);
                                        return (
                                        <div key={section.label} className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                                    {section.label}
                                                </h4>
                                                <div className="flex items-center gap-2">
                                                    <Label htmlFor={`sidebar-section-${section.label}`} className="text-xs font-medium text-gray-400 dark:text-gray-500 cursor-pointer">
                                                        {allOn ? 'All shown' : 'Show all'}
                                                    </Label>
                                                    <Switch
                                                        id={`sidebar-section-${section.label}`}
                                                        checked={allOn}
                                                        onCheckedChange={(value) => setSidebarSection(sectionKeys, value)}
                                                        disabled={!isAuthorized || isSavingSettings}
                                                        size="small"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {visibleItems.map(({ key, label }) => (
                                                    <div
                                                        key={key}
                                                        className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-600 px-4 py-3"
                                                    >
                                                        <Label htmlFor={`sidebar-${key}`} className="cursor-pointer">
                                                            {label}
                                                        </Label>
                                                        <Switch
                                                            id={`sidebar-${key}`}
                                                            checked={settings.sidebarConfig[key]}
                                                            onCheckedChange={() => toggleSidebarModule(key)}
                                                            disabled={!isAuthorized || isSavingSettings}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                            {hasMore && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedSections(prev => ({ ...prev, [section.label]: !isExpanded }))}
                                                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                                >
                                                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                    {isExpanded ? 'Show less' : `Show ${section.items.length - VISIBLE_ITEMS_CAP} more`}
                                                </button>
                                            )}
                                        </div>
                                        );
                                    })}
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-xl bg-white dark:bg-gray-800 overflow-hidden">
                                <CardHeader className="border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-indigo-600/5 to-purple-600/5">
                                    <div className="flex items-center gap-2">
                                        <ToggleLeft className="h-5 w-5 text-indigo-600" />
                                        <CardTitle>Feature Flags</CardTitle>
                                    </div>
                                    <CardDescription>
                                        Operational switches that change business logic across the workspace.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-6">
                                    <div className="space-y-3">
                                        {(Object.keys(FEATURE_FLAG_LABELS) as (keyof IFeatureFlags)[]).map((key) => (
                                            <div
                                                key={key}
                                                className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 dark:border-gray-600 px-4 py-3"
                                            >
                                                <div className="space-y-0.5">
                                                    <Label htmlFor={`flag-${key}`} className="cursor-pointer">
                                                        {FEATURE_FLAG_LABELS[key].label}
                                                    </Label>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                        {FEATURE_FLAG_LABELS[key].description}
                                                    </p>
                                                </div>
                                                <Switch
                                                    id={`flag-${key}`}
                                                    checked={settings.featureFlags[key]}
                                                    onCheckedChange={() => toggleFeatureFlag(key)}
                                                    disabled={!isAuthorized || isSavingSettings}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-xl bg-white dark:bg-gray-800 overflow-hidden">
                                <CardHeader className="border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-purple-600/5 to-pink-600/5">
                                    <div className="flex items-center gap-2">
                                        <SlidersHorizontal className="h-5 w-5 text-purple-600" />
                                        <CardTitle>Preferences</CardTitle>
                                    </div>
                                    <CardDescription>
                                        Cosmetic and default-experience settings for this workspace.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <Label>Language</Label>
                                            <Select
                                                value={settings.preferences.language}
                                                onValueChange={(value) => updatePreference('language', value)}
                                                disabled={!isAuthorized || isSavingSettings}
                                            >
                                                <SelectTrigger className="w-full rounded-xl">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {LANGUAGE_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Timezone</Label>
                                            <Input
                                                value={settings.preferences.timezone}
                                                onChange={(e) => updatePreference('timezone', e.target.value)}
                                                disabled={!isAuthorized || isSavingSettings}
                                                placeholder="e.g. Africa/Kigali"
                                                className="rounded-xl"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Date Format</Label>
                                            <Select
                                                value={settings.preferences.dateFormat}
                                                onValueChange={(value) => updatePreference('dateFormat', value)}
                                                disabled={!isAuthorized || isSavingSettings}
                                            >
                                                <SelectTrigger className="w-full rounded-xl">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {DATE_FORMAT_OPTIONS.map((fmt) => (
                                                        <SelectItem key={fmt} value={fmt}>
                                                            {fmt}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Default Landing Page</Label>
                                            <Select
                                                value={settings.preferences.defaultLandingPage}
                                                onValueChange={(value) => updatePreference('defaultLandingPage', value)}
                                                disabled={!isAuthorized || isSavingSettings}
                                            >
                                                <SelectTrigger className="w-full rounded-xl">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {SIDEBAR_SECTIONS.map((section) => (
                                                        <SelectGroup key={section.label}>
                                                            <SelectLabel>{section.label}</SelectLabel>
                                                            {section.items.map(({ key, label }) => (
                                                                <SelectItem key={key} value={key}>
                                                                    {label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectGroup>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Low Stock Threshold Override</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                value={settings.preferences.lowStockThresholdOverride ?? ''}
                                                onChange={(e) =>
                                                    updatePreference(
                                                        'lowStockThresholdOverride',
                                                        e.target.value === '' ? null : Number(e.target.value)
                                                    )
                                                }
                                                disabled={!isAuthorized || isSavingSettings}
                                                placeholder="Use per-product thresholds"
                                                className="rounded-xl"
                                            />
                                        </div>
                                    </div>

                                    {isAuthorized && (
                                        <div className="flex justify-end pt-6 mt-6 border-t border-gray-100 dark:border-gray-700">
                                            <Button
                                                onClick={handleSettingsSave}
                                                disabled={isSavingSettings}
                                                className="bg-blue-600 hover:bg-blue-700 text-white px-8 rounded-xl shadow-lg shadow-blue-500/20"
                                            >
                                                {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                                Save Settings
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    )}
                </TabsContent>
            </Tabs>

            {/* Branch Upsert Dialog */}
            <Drawer open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
                <DrawerContent className="sm:max-w-md rounded-2xl border-none shadow-2xl p-0 overflow-hidden">
                    <DrawerHeader className="p-6 bg-indigo-600 text-white">
                        <DrawerTitle className="text-xl font-bold">
                            {editingBranch ? 'Edit Branch' : 'Create New Branch'}
                        </DrawerTitle>
                        <DrawerDescription className="text-indigo-100">
                            Enter the details for your business branch.
                        </DrawerDescription>
                    </DrawerHeader>
                    <div className="p-6 space-y-4 bg-white dark:bg-gray-800">
                        <div className="space-y-2">
                            <Label htmlFor="branch-name">Branch Name</Label>
                            <Input
                                id="branch-name"
                                value={branchFormData.name}
                                onChange={(e) => setBranchFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g. Kigali Heights, Downtown Outlet"
                                className="rounded-xl"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="branch-code">Branch Identifier/Code</Label>
                            <Input
                                id="branch-code"
                                value={branchFormData.code}
                                onChange={(e) => setBranchFormData(prev => ({ ...prev, code: e.target.value }))}
                                placeholder="e.g. KGL-01, DWT-02"
                                className="rounded-xl font-mono text-sm uppercase"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="branch-location">Location / Area</Label>
                            <Input
                                id="branch-location"
                                value={branchFormData.location}
                                onChange={(e) => setBranchFormData(prev => ({ ...prev, location: e.target.value }))}
                                placeholder="e.g. Gasabo, Kigali"
                                className="rounded-xl"
                            />
                        </div>
                    </div>
                    <DrawerFooter className="p-6 bg-gray-50 dark:bg-gray-900/50 flex gap-2">
                        <Button variant="ghost" onClick={() => setBranchDialogOpen(false)} className="rounded-xl">
                            Cancel
                        </Button>
                        <Button onClick={handleBranchSave} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4">
                            {editingBranch ? 'Update Branch' : 'Create Branch'}
                        </Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
}
