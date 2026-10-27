import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export const useSales = (filters: any) => {
    return useQuery({
        queryKey: ['sales', filters],
        queryFn: () => apiClient.getSalesReport(filters),
        staleTime: 60 * 1000, // 1 minute
    });
};
