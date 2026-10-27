import { apiClient } from "../lib/api-client";

// Types
export interface DashboardStats {
  stats: {
    totalOrganizations: number;
    activeOrganizations: number;
    inactiveOrganizations: number;
    totalUsers: number;
    activeSubscriptions: number;
    expiringSubscriptions: number;
    totalRevenue: number;
    pendingPayments: number;
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
}

export interface Organization {
  id: number;
  name: string;
  businessType: string;
  address: string;
  phone: string;
  email: string;
  isActive: boolean;
  avatar: string;
  owner: {
    name: string;
    email: string;
  } | null;
  subscription: {
    status: string;
    startDate: string;
    endDate: string;
  } | null;
  stats: {
    products: number;
    sales: number;
    customers: number;
  };
  createdAt: string;
}

export interface Subscription {
  id: number;
  organizationId: number;
  planId: string;
  status: string;
  startDate: string;
  endDate: string;
  amount: number;
  paymentDetails?: {
    ref?: string;
    amount?: number;
    status?: string;
    currency?: string;
  } | null;
  organization: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
}

export interface Payment {
  id: number;
  subscriptionId: number;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentId: string | null;
  status: string;
  receiptUrl: string | null;
  metadata: any;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscription: {
    id: number;
    startDate: string | null;
    endDate: string | null;
    autoRenew: boolean;
    billingMode: string;
    plan: {
      id: number;
      name: string;
      price?: number;
      currency?: string;
    } | null;
    organization: {
      id: number;
      name: string;
      email?: string | null;
      phone?: string | null;
    };
  };
}

export const systemOwnerService = {
  async getDashboardStats(): Promise<DashboardStats> {
    const response = await apiClient.request('/system-owner/dashboard/stats', {
      method: 'GET',
    });
    return response;
  },

  async getOrganizations(page: number = 1, limit: number = 10, search: string = '') {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(search && { search })
    });

    const response = await apiClient.request(`/system-owner/organizations?${params.toString()}`, {
      method: 'GET',
    });
    return response;
  },

  async getOrganizationDetails(id: string | number) {
    const response = await apiClient.request(`/system-owner/organizations/${id}`, {
      method: 'GET',
    });
    return response;
  },

  async updateOrganizationStatus(id: string | number, isActive: boolean) {
    const response = await apiClient.request(`/system-owner/organizations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    return response;
  },

  async getSubscriptions() {
    const response = await apiClient.request('/system-owner/subscriptions', {
      method: 'GET',
    });
    return response;
  },

  async getExpiringSubscriptions() {
    const response = await apiClient.request('/system-owner/subscriptions/expiring', {
      method: 'GET',
    });
    return response;
  },

  async getPayments() {
    const response = await apiClient.request('/system-owner/payments', {
      method: 'GET',
    });
    return response;
  },

  async getPendingPayments() {
    const response = await apiClient.request('/system-owner/payments/pending', {
      method: 'GET',
    });
    return response;
  },

  async getRevenueAnalytics() {
    const response = await apiClient.request('/system-owner/analytics/revenue', {
      method: 'GET',
    });
    return response;
  },

  async getGrowthAnalytics() {
    const response = await apiClient.request('/system-owner/analytics/growth', {
      method: 'GET',
    });
    return response;
  },

  async extendSubscription(id: number, data: { endDate?: string; monthsToAdd?: number }) {
    const response = await apiClient.request(`/system-owner/subscriptions/${id}/extend`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response;
  },

  async updatePaymentStatus(id: string | number, status: string) {
    const response = await apiClient.request(`/system-owner/payments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return response;
  },

  async resendInvoice(id: string | number) {
    const response = await apiClient.request(`/system-owner/payments/${id}/resend-invoice`, {
      method: 'POST',
    });
    return response;
  },
};
