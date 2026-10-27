import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import i18n from '../i18n';
import { apiClient } from '../lib/api-client';
import { DEFAULT_ORGANIZATION_SETTINGS, type IOrganizationSettings } from '../types/organizationSettings';

interface OrganizationSettingsContextType {
    settings: IOrganizationSettings;
    loading: boolean;
    refreshSettings: () => Promise<void>;
}

const OrganizationSettingsContext = createContext<OrganizationSettingsContextType | undefined>(undefined);

export const OrganizationSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<IOrganizationSettings>(DEFAULT_ORGANIZATION_SETTINGS);
    const [loading, setLoading] = useState(true);

    const loadSettings = useCallback(async () => {
        const orgId = localStorage.getItem('current_organization_id');
        if (!orgId) {
            setSettings(DEFAULT_ORGANIZATION_SETTINGS);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await apiClient.getOrganizationSettings(orgId);
            const fetched: IOrganizationSettings = response?.settings || DEFAULT_ORGANIZATION_SETTINGS;
            setSettings(fetched);

            // Apply the org's default language only if this browser has no
            // explicit personal language choice yet (LanguageSwitcher owns that).
            if (!localStorage.getItem('i18nextLng') && fetched.preferences.language) {
                i18n.changeLanguage(fetched.preferences.language);
            }
        } catch (error) {
            console.error('Failed to fetch organization settings:', error);
            setSettings(DEFAULT_ORGANIZATION_SETTINGS);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'current_organization_id') {
                loadSettings();
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, [loadSettings]);

    return (
        <OrganizationSettingsContext.Provider value={{ settings, loading, refreshSettings: loadSettings }}>
            {children}
        </OrganizationSettingsContext.Provider>
    );
};

export const useOrganizationSettings = (): OrganizationSettingsContextType => {
    const context = useContext(OrganizationSettingsContext);
    if (!context) {
        throw new Error('useOrganizationSettings must be used within an OrganizationSettingsProvider');
    }
    return context;
};
