import { apiClient } from './api-client';
import { MODULE_ROUTES, type ISidebarConfig } from '../types/organizationSettings';

/** Resolves the org's configured post-login landing page to a dashboard route. */
export async function resolveLandingPath(organizationId: number | string): Promise<string> {
    try {
        const response = await apiClient.getOrganizationSettings(organizationId);
        const page = response?.settings?.preferences?.defaultLandingPage as keyof ISidebarConfig | undefined;
        return (page && MODULE_ROUTES[page]) || '/dashboard';
    } catch {
        return '/dashboard';
    }
}
