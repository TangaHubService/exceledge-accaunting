import React from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../../lib/api-client';
import { OrdersList } from '../orders/OrdersList';

export const OrdersPage: React.FC = () => {
    const { t } = useTranslation();
    const organizationId = apiClient.getOrganizationId();

    if (!organizationId) {
        return <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>;
    }

    return <OrdersList organizationId={organizationId} />;
};
