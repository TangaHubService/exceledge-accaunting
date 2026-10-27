import React from 'react';
import { apiClient } from '../../../lib/api-client';
import Suppliers from './suppliers';

export const SuppliersPage: React.FC = () => {
    const organizationId = apiClient.getOrganizationId();

    if (!organizationId) {
        return <div>Loading organization data...</div>;
    }

    return <Suppliers apiClient={apiClient} organizationId={organizationId} />;
};
