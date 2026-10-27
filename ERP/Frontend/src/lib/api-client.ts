import { toast } from 'react-toastify';

const API_URL = (import.meta.env.VITE_PUBLIC_API_URL || 'http://localhost:5000') + '/api';

const REFRESH_TOKEN_KEY = 'refresh_token';

// Public auth pages where we should never redirect to /login (prevents refresh loops)
const isPublicAuthPage = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  return path === '/' ||
    path === '/landing' ||
    path === '/login' ||
    path === '/reset-password' ||
    path === '/forgot-password' ||
    path === '/signup' ||
    path === '/verify';
};

// Helper function to handle JWT expiration and logout
const handleTokenExpiration = () => {
  // Prevent redirect loop — we're already on a public auth page
  if (isPublicAuthPage()) {
    return;
  }
  // Clear all authentication-related data from localStorage
  const keysToRemove = [
    'token',
    REFRESH_TOKEN_KEY,
    'user',
    'current_organization_id',
    'selected_branch_id',
    'organization',
  ];
  keysToRemove.forEach(key => localStorage.removeItem(key));
  // Redirect to login page
  window.location.href = '/login';
};

// A lapsed subscription past its grace period returns 403 SUBSCRIPTION_INACTIVE
// on operational routes (see requireActiveSubscription middleware). There was
// previously no frontend handling of this code at all — requests just failed
// silently wherever they were called. Surface it once and send the user to
// the renewal page instead.
const handleSubscriptionInactive = (errorData: any) => {
  if (errorData?.code !== 'SUBSCRIPTION_INACTIVE') return;
  if (typeof window === 'undefined') return;
  if (window.location.pathname.includes('/subscription')) return;
  toast.error(errorData.error || errorData.message || 'Your subscription has expired. Please renew your subscription to continue using the system.');
  window.location.href = '/dashboard/subscription';
};

/** Backend returns accessToken + refreshToken on login; older flows used token (e.g. switch-organization). */
function extractAccessToken(body: {
  accessToken?: string;
  token?: string;
  refreshToken?: string;
}): string | undefined {
  return body.accessToken ?? body.token;
}

class ApiClient {
  private token: string | null = null;
  private _refreshPromise: Promise<boolean> | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== "undefined") {
      localStorage.setItem("token", token);
    }
  }

  /** Store access + refresh tokens from login/refresh responses. */
  persistAuthFromResponse(body: {
    accessToken?: string;
    token?: string;
    refreshToken?: string;
  }) {
    const access = extractAccessToken(body);
    if (access) {
      this.setToken(access);
    }
    if (typeof window !== "undefined" && body.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, body.refreshToken);
    }
  }

  private authPathExemptFromRefreshRetry(endpoint: string): boolean {
    return (
      endpoint.startsWith('/auth/login') ||
      endpoint.startsWith('/auth/signup') ||
      endpoint.startsWith('/auth/refresh') ||
      endpoint.startsWith('/auth/reset-password') ||
      endpoint.startsWith('/auth/request-password-reset')
    );
  }

  private async tryRefreshAccessToken(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // If a refresh is already in-flight, reuse its result
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!rt) return false;

    this._refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        this.persistAuthFromResponse(data);
        return !!extractAccessToken(data);
      } catch {
        return false;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  /** When access JWT is expired, obtain a new pair using the stored refresh token (e.g. on app load). */
  async trySilentRefresh(): Promise<boolean> {
    return this.tryRefreshAccessToken();
  }

  getToken() {
    if (!this.token && typeof window !== "undefined") {
      this.token = localStorage.getItem("token");
    }
    return this.token;
  }

  getOrganizationId() {
    const organizationId = localStorage.getItem("current_organization_id");
    if (!organizationId) {
      throw new Error("Organization ID not found");
    }
    return organizationId;
  }

  async get(endpoint: string, options: RequestInit = {}) {
    const data = await this.request(endpoint, { ...options, method: "GET" });
    return { data }; // Wrap in data property to match Axios-like usage in some contexts
  }

  async getOrders(organizationId: string) {
    return this.request(`/organizations/${organizationId}/purchase-orders`, {
      method: 'GET',
    });
  }

  /** Read the currently selected branch from localStorage, if any. */
  private getBranchQueryParam(endpoint?: string): string {
    // An explicit branch in the request takes precedence over the selected branch.
    if (endpoint && new URLSearchParams(endpoint.split('?')[1] || '').has('branchId')) return '';
    if (typeof window === 'undefined') return '';
    const saved = localStorage.getItem('selected_branch_id');
    if (saved && saved !== 'all' && saved !== 'undefined' && saved !== 'null') {
      return `branchId=${saved}`;
    }
    return '';
  }

  async request(
    endpoint: string,
    options: RequestInit & { _authRetried?: boolean } = {}
  ): Promise<any> {
    const { _authRetried, ...fetchOptions } = options;
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(fetchOptions.headers as Record<string, string>),
    };

    // Only set Content-Type to application/json if not FormData and not already set
    if (!(fetchOptions.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // ── Auto-inject branchId into query string ──────────────────────
    const branchParam = this.getBranchQueryParam(endpoint);
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = branchParam ? `${API_URL}${endpoint}${separator}${branchParam}` : `${API_URL}${endpoint}`;

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (
      response.status === 401 &&
      !_authRetried &&
      !this.authPathExemptFromRefreshRetry(endpoint) &&
      typeof window !== 'undefined'
    ) {
      const refreshed = await this.tryRefreshAccessToken();
      if (refreshed) {
        return this.request(endpoint, { ...fetchOptions, _authRetried: true });
      }
      // Refresh failed — token is dead
      handleTokenExpiration();
      const error = new Error("Session expired. Please login again.");
      (error as any).response = { status: 401, data: { error: "Unauthorized" } };
      throw error;
    }

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "An error occurred" }));
      if (response.status === 403) {
        handleSubscriptionInactive(errorData);
      }
      const error = new Error(errorData.message || errorData.error || "An error occurred");
      // Attach response data for better error handling
      (error as any).response = {
        status: response.status,
        data: errorData
      };
      throw error;
    }

    return response.json();
  }

  async requestFile(endpoint: string, options: RequestInit & { _authRetried?: boolean } = {}): Promise<Response> {
    const { _authRetried, ...fetchOptions } = options;
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // ── Auto-inject branchId into query string (same as request()) ──
    // File downloads/exports must respect the selected branch too, or an
    // export could silently include other branches' data.
    const branchParam = this.getBranchQueryParam(endpoint);
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = branchParam ? `${API_URL}${endpoint}${separator}${branchParam}` : `${API_URL}${endpoint}`;

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (
      response.status === 401 &&
      !_authRetried &&
      !this.authPathExemptFromRefreshRetry(endpoint) &&
      typeof window !== 'undefined'
    ) {
      const refreshed = await this.tryRefreshAccessToken();
      if (refreshed) {
        return this.requestFile(endpoint, { ...fetchOptions, _authRetried: true });
      }
      // Refresh failed — token is dead
      handleTokenExpiration();
      const error = new Error("Session expired. Please login again.");
      (error as any).response = { status: 401, data: { error: "Unauthorized" } };
      throw error;
    }

    if (!response.ok) {
      // Handle JWT expiration (401 Unauthorized) for non-retryable cases
      if (response.status === 401) {
        handleTokenExpiration();
        const error = new Error("Session expired. Please login again.");
        (error as any).response = {
          status: response.status,
          data: { error: "Unauthorized" }
        };
        throw error;
      }

      const errorData = await response
        .json()
        .catch(() => ({ error: "An error occurred" }));
      if (response.status === 403) {
        handleSubscriptionInactive(errorData);
      }
      const error = new Error(errorData.message || errorData.error || "An error occurred");
      // Attach response data for better error handling
      (error as any).response = {
        status: response.status,
        data: errorData
      };
      throw error;
    }

    return response;
  }

  // Auth endpoints
  async signup(data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) {
    const response = await this.request("/auth/signup", {
      method: "POST",
      body: JSON.stringify(data),
    });
    this.persistAuthFromResponse(response);
    return response;
  }

  async login(data: { email: string; password: string }) {
    const response = await this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
    this.persistAuthFromResponse(response);
    return response;
  }

  async switchOrganization(data: { organizationId: string | number }) {
    const response = await this.request("/auth/switch-organization", {
      method: "POST",
      body: JSON.stringify(data),
    });
    this.persistAuthFromResponse(response as { accessToken?: string; token?: string; refreshToken?: string });
    return response;
  }

  async logout() {
    localStorage.removeItem("token");
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    return this.request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    }
    );
  }

  async verifyAccount(data: { code: string }) {
    return this.request("/auth/verify-account", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async resendVerificationCode(data: { email: string }) {
    return this.request("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async resetPassword(data: { code: string; newPassword: string; email: string }) {
    return this.request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async requestPasswordReset(data: { email: string }) {
    return this.request("/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createOrganization(data: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  }) {
    return this.request("/organizations", {
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
      },
    });
  }

  async getUserOrganizations() {
    return this.request("/organizations");
  }

  async getOrganization(id: string) {
    return this.request(`/organizations/${id}`);
  }

  async updateOrganization(data: any) {
    return this.request(`/organizations/${this.getOrganizationId()}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getOrganizationSettings(id: string | number) {
    return this.request(`/organizations/${id}/settings`);
  }

  async updateOrganizationSettings(id: string | number, patch: any) {
    return this.request(`/organizations/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async updateProfile(formData: any, id: string | number) {
    return this.request(`/users/${this.getOrganizationId()}/update/${id}`, {
      method: "PUT",
      body: JSON.stringify(formData),
    });
  }

  private async fetchWithRefresh(url: string, options: RequestInit & { _authRetried?: boolean } = {}): Promise<Response> {
    const { _authRetried, ...fetchOptions } = options;
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...fetchOptions, headers });

    if (
      response.status === 401 &&
      !_authRetried &&
      typeof window !== 'undefined'
    ) {
      const refreshed = await this.tryRefreshAccessToken();
      if (refreshed) {
        // Retry with fresh token
        const newToken = this.getToken();
        const retryHeaders: Record<string, string> = {
          ...(fetchOptions.headers as Record<string, string>),
        };
        if (newToken) {
          retryHeaders["Authorization"] = `Bearer ${newToken}`;
        }
        return fetch(url, { ...fetchOptions, headers: retryHeaders });
      }
      handleTokenExpiration();
      throw Object.assign(new Error("Session expired. Please login again."), {
        response: { status: 401, data: { error: "Unauthorized" } },
      });
    }

    return response;
  }

  async updateProfileImage(formData: FormData, id: string | number) {
    const response = await this.fetchWithRefresh(
      `${API_URL}/users/profile-image/${id}`,
      { method: "PUT", body: formData },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Failed to update profile image" }));
      throw new Error(error.error || "Failed to update profile image");
    }

    return response.json();
  }

  async uploadAvatar(formData: FormData) {
    const response = await this.fetchWithRefresh(
      `${API_URL}/organizations/avatar/${this.getOrganizationId()}`,
      { method: "PUT", body: formData },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Failed to upload avatar" }));
      throw new Error(error.error || "Failed to upload avatar");
    }

    return response.json();
  }

  // Dashboard endpoints
  async getDashboardStats(days = "7") {
    return this.request(`/dashboard/stats/${this.getOrganizationId()}?days=${days}`);
  }

  async getBranchDashboardStats(params: {
    preset?: 'today' | 'weekly' | 'monthly'
    startDate?: string
    endDate?: string
  }) {
    const query = new URLSearchParams()
    if (params.preset) query.set('preset', params.preset)
    if (params.startDate) query.set('startDate', params.startDate)
    if (params.endDate) query.set('endDate', params.endDate)
    const qs = query.toString()
    return this.request(`/dashboard/branch-stats/${this.getOrganizationId()}${qs ? '?' + qs : ''}`)
  }

  async getOverviewDashboard(params: {
    preset?: string
    startDate?: string
    endDate?: string
  }) {
    const query = new URLSearchParams()
    if (params.preset) query.set('preset', params.preset)
    if (params.startDate) query.set('startDate', params.startDate)
    if (params.endDate) query.set('endDate', params.endDate)
    const qs = query.toString()
    return this.request(`/dashboard/overview/${this.getOrganizationId()}${qs ? '?' + qs : ''}`)
  }

  async getSalesTrend(days = "7") {
    return this.request(
      `/dashboard/sales-trend/${this.getOrganizationId()}?days=${days}`
    );
  }

  async getTopSellingProducts() {
    return this.request(`/dashboard/${this.getOrganizationId()}/top-selling-products`);
  }

  async getDetailedInventory(query?: any) {
    return this.request(`/dashboard/${this.getOrganizationId()}/detailed-inventory?${query}`);
  }

  async getNotifications() {
    return this.request(`/dashboard/notifications/${this.getOrganizationId()}`);
  }

  async fetchNotifications(params?: { unread?: boolean; page?: number; pageSize?: number }) {
    const query = params ? `?${new URLSearchParams({
      ...(params.unread !== undefined ? { unread: String(params.unread) } : {}),
      ...(params.page ? { page: String(params.page) } : {}),
      ...(params.pageSize ? { pageSize: String(params.pageSize) } : {}),
    }).toString()}` : '';
    return this.request(`/notifications/${this.getOrganizationId()}${query}`);
  }

  async markNotificationRead(id: string) {
    return this.request(`/notifications/${this.getOrganizationId()}/${id}/read`, {
      method: 'PATCH',
    });
  }

  // Add to api-client.ts
  async refundSale(saleId: string, data: { reason?: string; rfdRsnCd?: string; recipientName?: string; items?: Array<{ saleItemId: string | number; quantity: number }>; receiptMode?: 'TRAINING' | 'NORMAL' }) {
    const organizationId = this.getOrganizationId();
    return this.request(`/sales/${saleId}/refund/${organizationId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** What can still be refunded on a sale (original detail + per-line remaining + prior refunds). */
  async getRefundable(saleId: string | number) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/refundable`);
  }

  /** RRA refund reason codes (code class 32) for the refund-reason dropdown. */
  async getRraRefundReasons() {
    return this.request(`${this.rraBase()}/refund-reasons`);
  }

  /** ERP → RRA payment-method mappings for display/validation. */
  async getRraPaymentMappings() {
    return this.request(`${this.rraBase()}/payment-mappings`);
  }

  /** Void/cancel a sale (marks it CANCELLED, restores stock, fiscalizes a VOID invoice). */
  async cancelSale(saleId: string, data: { reason: string }) {
    const organizationId = this.getOrganizationId();
    return this.request(`/sales/${organizationId}/${saleId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** VSDC/EBM presence status for the offline-guard indicator. */
  async getEbmStatus() {
    return this.request(`/organizations/${this.getOrganizationId()}/ebm-status`);
  }

  // Activity Logs endpoints
  async getActivityLogs(params?: {
    startDate?: string;
    endDate?: string;
    userId?: string;
    type?: string;
    entityType?: string;
    entityId?: string;
    page?: number;
    limit?: number;
  }) {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return this.request(`/activity-logs/${this.getOrganizationId()}${query}`);
  }

  // Sales endpoints
  async createSale(data: any) {
    return this.request(`/sales/${this.getOrganizationId()}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getSales(params?: any) {
    const query = new URLSearchParams({ ...params }).toString();
    return this.request(`/sales/${this.getOrganizationId()}?${query}`);
  }

  /** Replace a proforma's line items / customer (only before it is converted). */
  async updateProforma(
    saleId: string | number,
    data: { customerId?: number; items: Array<{ productId?: number; quantity: number; unitPrice: number; itemType?: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE'; serviceName?: string; serviceDescription?: string }> },
  ) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/proforma`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /** Convert a proforma into a real, fiscalized NS sale. */
  async convertProforma(
    saleId: string | number,
    data: {
      paymentType?: string;
      cashAmount?: number;
      debtAmount?: number;
      insuranceAmount?: number;
      payments?: Array<{ paymentMethod: string; amount: number; reference?: string }>;
      items?: Array<{ productId?: number; quantity: number; unitPrice: number; itemType?: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE'; serviceName?: string }>;
      customerId?: number;
    },
  ) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/convert`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getSale(id: string) {
    return this.request(`/sales/${this.getOrganizationId()}/${id}`);
  }

  /**
   * Composed ERP invoice payload for the modern RRA/EBM invoice renderer.
   * Pass `allowPending` to also get the payload for a real sale VSDC has not
   * confirmed yet (it comes back stamped NOT FISCALISED); without it the
   * endpoint returns 425 while fiscalization is still in flight, which the
   * fiscalization poll relies on.
   */
  async getInvoice(id: string | number, opts: { allowPending?: boolean } = {}) {
    const query = opts.allowPending ? "?allowPending=1" : "";
    return this.request(`/sales/${this.getOrganizationId()}/invoices/${id}${query}`);
  }

  /** Authoritative backend-generated EBM invoice PDF, in A4, A5, or 80mm (thermal receipt) format. */
  async getInvoicePdf(id: string | number, format: "A4" | "A5" | "80mm" = "A4") {
    const query = format === "A4" ? "" : `?format=${format}`;
    return this.requestFile(`/sales/${this.getOrganizationId()}/invoices/${id}/pdf${query}`, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });
  }

  async recordPayment(id: string, data: { amount: number }) {
    return this.request(`/sales/${id}/${this.getOrganizationId()}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async regenerateInvoice(saleId: string | number) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/regenerate-invoice`, {
      method: "POST",
    })
  }

  /**
   * CIS/VSDC spec §7.18/§15: registers one download of this invoice's PDF.
   * The first registered download is the original; every one after that
   * makes the backend render the PDF as a COPY (CS/CR) receipt. Called
   * automatically before every deliberate download — there's no separate
   * "copy" action to trigger by hand.
   */
  async reprintSale(saleId: string | number) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/reprint`, {
      method: "POST",
    })
  }

  /** Queue an 80mm receipt print on a logged-in POS app for this sale's branch. */
  async enqueuePosPrint(saleId: string | number, copies = 1) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/pos-print`, {
      method: "POST",
      body: JSON.stringify({ copies }),
    })
  }

  /**
   * CS/CR: PDF copy of an existing NS (Copy Sale) or NR (Copy Refund) receipt,
   * carrying the original receipt's VSDC fiscal data and marked COPY. The
   * backend records the copy; it never creates a new sale/refund.
   */
  async printReceiptCopy(saleId: string | number, format: "A4" | "A5" | "80mm" = "A4") {
    return this.requestFile(`/sales/${this.getOrganizationId()}/${saleId}/copy?format=${format}`, {
      method: "POST",
      headers: { Accept: "application/pdf" },
    })
  }

  async getActiveShift() {
    return this.request(`/shifts/${this.getOrganizationId()}/active`);
  }

  async openShift(data: {
    openingFloat: number;
    openingMobileMoney?: number;
    branchId?: number | null;
    deviceId?: number;
    openingNotes?: string;
  }) {
    return this.request(`/shifts/${this.getOrganizationId()}`, {
      method: "POST",
      body: JSON.stringify({
        openingFloat: data.openingFloat,
        openingMobileMoney: data.openingMobileMoney ?? 0,
        branchId: data.branchId ?? undefined,
        deviceId: data.deviceId ?? undefined,
        openingNotes: data.openingNotes ?? undefined,
      }),
    });
  }

  async getShiftSummary(id: string | number) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/summary`);
  }

  async getShiftDetails(id: string | number) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/details`);
  }

  async listShifts(params?: Record<string, any>) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/shifts/${this.getOrganizationId()}${query}`);
  }

  async getDailyShiftSummary(params?: Record<string, any>) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/shifts/${this.getOrganizationId()}/daily${query}`);
  }

  async startShiftClose(id: string | number) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/start-close`, {
      method: "POST",
    });
  }

  async submitShiftClose(
    id: string | number,
    data: {
      actualCash: number;
      actualMobileMoney?: number;
      varianceReason?: string;
      closingNotes?: string;
      denominationCounts?: Record<string, number>;
    }
  ) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/submit-close`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async approveShift(id: string | number, reason?: string) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async rejectShift(id: string | number, reason?: string) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async reopenShift(id: string | number, reason?: string) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/reopen`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async cancelShift(id: string | number) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/cancel`, {
      method: "POST",
    });
  }

  async createCashMovement(data: {
    shiftId: string | number;
    type: "CASH_IN" | "CASH_OUT";
    amount: number;
    reason?: string;
    reference?: string;
    branchId?: number | null;
  }) {
    return this.request(`/shifts/${this.getOrganizationId()}/cash-movements`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async closeShift(id: string | number, data: { actualCash: number; closingNotes?: string }) {
    return this.request(`/shifts/${this.getOrganizationId()}/${id}/close`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Inventory endpoints
  async getProducts(params?: Record<string, any>) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/inventory/products/${this.getOrganizationId()}${query}`);
  }

  async createProduct(data: any) {
    return this.request(`/inventory/${this.getOrganizationId()}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createProducts(data: any, branchId?: number | null) {
    const query = branchId ? `?branchId=${branchId}` : "";
    return this.request(`/inventory/${this.getOrganizationId()}/products${query}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateProduct(id: string, data: any) {
    return this.request(`/inventory/${this.getOrganizationId()}/product/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteProduct(id: string) {
    return this.request(`/inventory/${this.getOrganizationId()}/product/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
      },
    });
  }

  async getExpiringProducts(params?: any) {
    const query = new URLSearchParams({
      organizationId: this.getOrganizationId(),
      ...params,
    }).toString();
    return this.request(`/inventory/products/${this.getOrganizationId()}/expiring?${query}`);
  }

  // Customer endpoints
  async getCustomers(params?: any) {
    const queryParams = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      // URLSearchParams serialises `undefined` as the literal text
      // "undefined", which Prisma must not receive for enum filters.
      if (value !== undefined && value !== null && value !== '') {
        queryParams.set(key, String(value));
      }
    });
    const query = queryParams.toString();
    return this.request(`/customers/${this.getOrganizationId()}?${query}`);
  }

  async getCustomerById(id: string, organizationId?: string | number) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/customers/${org}/${id}`);
  }

  async createCustomer(data: any) {
    return this.request(`/customers/${this.getOrganizationId()}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCustomer(id: string, data: any) {
    return this.request(`/customers/${id}/${this.getOrganizationId()}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getCustomerDebtors() {
    return this.request(`/customers/debtors?pharmacyId=${this.getOrganizationId()}`);
  }

  async profile() {
    return this.request("/auth/me",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
        },
      }
    );
  }

  // System Owner endpoints
  async getSystemOwnerDashboardStats() {
    return this.request('/system-owner/dashboard/stats');
  }

  // User endpoints
  async getUsers(params?: { page?: number; limit?: number; search?: string; status?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
    const query = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return this.request(`/users/${this.getOrganizationId()}${query}`);
  }

  async reactivateUser(organizationId: string | number, userId: string | number) {
    return this.request(`/users/${organizationId}/reactivate/${userId}`, {
      method: "PUT",
    })
  }

  async inviteUser(data: { email: string; role: string; branchId?: number | null }) {
    return this.request(`/organizations/${this.getOrganizationId()}/invite`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async bulkInviteUsers(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("organizationId", this.getOrganizationId());

    const response = await this.fetchWithRefresh(
      `${API_URL}/organizations/${this.getOrganizationId()}/bulk-invite`,
      { method: "POST", body: formData },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "An error occurred" }));
      throw new Error(error.error || "An error occurred");
    }

    return response.json();
  }

  async getInvitationDetails(token: string) {
    return this.request(`/organizations/get-invitation/${token}`);
  }

  async acceptInvitation(token: string, name: string) {
    return this.request(`/organizations/accept-invitation/${token}`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async declineInvitation(token: string) {
    return this.request(`/organizations/decline-invitation/${token}`);
  }

  async getExpiredProducts(params?: any) {
    const query = new URLSearchParams(params).toString();
    return this.request(
      `/inventory/products/${this.getOrganizationId()}/expired?${query}`
    );
  }

  async getLowStockProducts(params?: any) {
    const query = new URLSearchParams(params).toString();
    return this.request(
      `/inventory/products/${this.getOrganizationId()}/low-stock?${query}`
    );
  }

  // Reports endpoints
  async getSalesReport(filters: {
    startDate: string;
    endDate: string;
    category?: string;
    status?: string;
    sellerId?: string;
    product?: string;
    maxAmount?: number;
    page?: number;
    limit?: number;
    branchId?: number | null;
  }) {
    const params = new URLSearchParams({
      startDate: filters.startDate,
      endDate: filters.endDate,
    });

    if (filters.category && filters.category !== 'all') {
      params.append('category', filters.category);
    }
    if (filters.status && filters.status !== 'all') {
      params.append('status', filters.status);
    }
    if (filters.sellerId && filters.sellerId !== 'all') {
      params.append('sellerId', filters.sellerId);
    }
    if (filters.product) {
      params.append('product', filters.product);
    }
    if (filters.page) {
      params.append('page', filters.page.toString());
    }
    if (filters.limit) {
      params.append('limit', filters.limit.toString());
    }
    if (filters.branchId !== undefined) {
      params.append('branchId', filters.branchId === null ? 'null' : filters.branchId.toString());
    }

    return this.request(
      `/reports/sales/${this.getOrganizationId()}?${params.toString()}`
    );
  }

  async getInventoryReport(query?: any) {
    const params = new URLSearchParams(query);
    return this.request(`/reports/inventory/${this.getOrganizationId()}?${params.toString()}`);
  }

  async getDebtorsReport() {
    return this.request(`/reports/debtors/${this.getOrganizationId()}`);
  }

  async getDebtPaymentsReport(startDate: string, endDate: string) {
    return this.request(
      `/reports/debt-payments/${this.getOrganizationId()}?startDate=${startDate}&endDate=${endDate}`
    );
  }

  async getCashFlowReport(startDate: string, endDate: string, sortBy = 'date', sortOrder: 'asc' | 'desc' = 'asc') {
    const query = new URLSearchParams({ startDate, endDate, sortBy, sortOrder });
    return this.request(`/reports/cash-flow/${this.getOrganizationId()}?${query}`);
  }

  async getStockReport(params: { startDate: string; endDate: string; productId?: string; category?: string }) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/reports/stock/${this.getOrganizationId()}?${query}`);
  }

  async getStockHistory(params: {
    productId?: string;
    batchNumber?: string;
    startDate?: string;
    endDate?: string;
    userId?: string;
    type?: string;
    limit?: number;
    page?: number;
  }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request(`/reports/stock-history/${this.getOrganizationId()}?${query}`);
  }

  // ── Fiscal reports (RRA CIS/VSDC) ──────────────────────────────────────
  /** X/Z daily fiscal report as structured JSON. type: 'X' (interim) | 'Z' (closing). */
  async getDailyFiscalReport(params: { type: "X" | "Z"; date?: string; branchId?: number | string }) {
    const q = new URLSearchParams({ type: params.type });
    if (params.date) q.set("date", params.date);
    if (params.branchId != null && params.branchId !== "") q.set("branchId", String(params.branchId));
    return this.request(`/reports/daily/${this.getOrganizationId()}?${q.toString()}`);
  }

  /** Printable (80mm) X/Z daily fiscal report PDF. */
  async getDailyFiscalReportPdf(params: { type: "X" | "Z"; date?: string; branchId?: number | string }) {
    const q = new URLSearchParams({ type: params.type });
    if (params.date) q.set("date", params.date);
    if (params.branchId != null && params.branchId !== "") q.set("branchId", String(params.branchId));
    return this.requestFile(`/reports/daily/${this.getOrganizationId()}/pdf?${q.toString()}`, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });
  }

  /** Printable (80mm) PLU report PDF. */
  async getPluReportPdf(params: { startDate?: string; endDate?: string; sortBy?: string } = {}) {
    const q = new URLSearchParams(params as Record<string, string>);
    return this.requestFile(`/reports/plu/${this.getOrganizationId()}/pdf?${q.toString()}`, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });
  }

  /** PLU report as structured JSON (paginated). */
  async getPluReport(params: { startDate?: string; endDate?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number } = {}) {
    const q = new URLSearchParams(params as Record<string, string>);
    return this.request(`/reports/plu/${this.getOrganizationId()}?${q.toString()}`);
  }

  /** CIS electronic journal — list entries for a period. */
  async getElectronicJournal(params: { startDate?: string; endDate?: string; page?: number; limit?: number } = {}) {
    const q = new URLSearchParams(params as Record<string, string>);
    return this.request(`/reports/electronic-journal/${this.getOrganizationId()}?${q.toString()}`);
  }

  /** CIS electronic journal — one sale's EJ record plus its slip data for §44 comparison. */
  async getElectronicJournalEntry(saleId: string | number) {
    return this.request(`/reports/electronic-journal/${this.getOrganizationId()}/${saleId}`);
  }

  /** Detailed purchases report (RRA checklist §25) — local POs + importation block. */
  async getPurchasesReport(params: { startDate?: string; endDate?: string } = {}) {
    const q = new URLSearchParams(params as Record<string, string>);
    return this.request(`/reports/purchases/${this.getOrganizationId()}?${q.toString()}`);
  }

  /** Importation report (RRA checklist §25). */
  async getImportationReport() {
    return this.request(`/reports/imports/${this.getOrganizationId()}`);
  }

  // ── RRA master-data (Codes §59 / Item Class §61 / Customer §62 / Select Item §64 / Notices §65) ──
  private rraBase() {
    return `/organizations/${this.getOrganizationId()}/rra`;
  }
  async getRraMasterDataStatus() {
    return this.request(`${this.rraBase()}/status`);
  }
  async syncAllRraMasterData() {
    return this.request(`${this.rraBase()}/sync-all`, { method: "POST" });
  }
  async listRraCodes(cdCls?: string) {
    const q = cdCls ? `?cdCls=${encodeURIComponent(cdCls)}` : "";
    return this.request(`${this.rraBase()}/codes${q}`);
  }
  async getRraCodeCatalog() {
    return this.request(`${this.rraBase()}/code-catalog`);
  }
  async syncRraCodes() {
    return this.request(`${this.rraBase()}/codes/sync`, { method: "POST" });
  }
  async searchRraItemClasses(q?: string, limit = 30) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    return this.request(`${this.rraBase()}/item-classes?${params.toString()}`);
  }
  async syncRraItemClasses() {
    return this.request(`${this.rraBase()}/item-classes/sync`, { method: "POST" });
  }
  async listRraNotices() {
    return this.request(`${this.rraBase()}/notices`);
  }
  async syncRraNotices() {
    return this.request(`${this.rraBase()}/notices/sync`, { method: "POST" });
  }
  async markRraNoticeRead(noticeNo: number) {
    return this.request(`${this.rraBase()}/notices/${noticeNo}/read`, { method: "POST" });
  }
  async verifyCustomerWithRra(tin: string, customerId?: number) {
    const q = customerId != null ? `?customerId=${customerId}` : "";
    return this.request(`${this.rraBase()}/customers/${encodeURIComponent(tin)}${q}`);
  }
  async reconcileRraItems() {
    return this.request(`${this.rraBase()}/items/reconcile`, { method: "POST" });
  }
  async syncOneProductToRra(productId: number, body: { itemClsCd?: string; taxCode?: string } = {}) {
    return this.request(`${this.rraBase()}/items/${productId}/sync`, { method: "POST", body: JSON.stringify(body) });
  }
  // Stock In/Out §72/§73
  async getRraStockStatus() {
    return this.request(`${this.rraBase()}/stock`);
  }
  async syncRraStock() {
    return this.request(`${this.rraBase()}/stock/sync`, { method: "POST" });
  }
  // B2B purchases §70/§71
  async listRraPurchases(status?: "PENDING" | "CONFIRMED" | "REJECTED") {
    const q = status ? `?status=${status}` : "";
    return this.request(`${this.rraBase()}/purchases${q}`);
  }
  async syncRraPurchases() {
    return this.request(`${this.rraBase()}/purchases/sync`, { method: "POST" });
  }
  async confirmRraPurchase(
    id: number,
    reject = false,
    body: {
      prcOrdCd?: string;
      remark?: string;
      items?: Array<{
        itemId?: number;
        itemSeq?: number;
        itemNm?: string;
        linkProductId?: number;
        sellingPrice?: number;
        expiryDate?: string;
      }>;
    } = {},
  ) {
    return this.request(`${this.rraBase()}/purchases/${id}/confirm${reject ? "?reject=true" : ""}`, {
      method: "POST",
      body: JSON.stringify({ ...body, reject }),
    });
  }
  // Import declarations §66/§67/§68
  async listRraImports(status?: "PENDING" | "APPROVED" | "REJECTED") {
    const q = status ? `?status=${status}` : "";
    return this.request(`${this.rraBase()}/imports${q}`);
  }
  async syncRraImports(requestDate?: string) {
    return this.request(`${this.rraBase()}/imports/sync`, {
      method: "POST",
      ...(requestDate ? { body: JSON.stringify({ requestDate }) } : {}),
    });
  }
  async actionRraImport(
    id: number,
    action: "approve" | "reject",
    body: {
      itemClsCd?: string;
      itemCd?: string;
      linkProductId?: number;
      createProduct?: boolean;
      itemNm?: string;
      remark?: string;
      sellingPrice?: number;
      expiryDate?: string;
    } = {},
  ) {
    return this.request(`${this.rraBase()}/imports/${id}/${action}`, { method: "POST", body: JSON.stringify(body) });
  }

  /** POST /branches/selectBranches — pull RRA-registered branches for this TIN. */
  async syncRraBranches() {
    return this.request(`${this.rraBase()}/branches/sync`, { method: "POST" });
  }

  /** POST /stock/selectStockItems — pull HQ↔branch stock movements from VSDC. */
  async syncRraStockMoves() {
    return this.request(`${this.rraBase()}/stock-moves/sync`, { method: "POST" });
  }

  /** POST /branches/saveBrancheCustomers — push one CIS customer to VSDC. */
  async syncCustomerToRra(customerId: number | string) {
    return this.request(`${this.rraBase()}/customers/${customerId}/sync`, { method: "POST" });
  }

  /** POST /branches/saveBrancheInsurances — push pharmacy insurer to VSDC. */
  async syncInsuranceToRra(customerId: number | string) {
    return this.request(`${this.rraBase()}/customers/${customerId}/insurance/sync`, { method: "POST" });
  }

  /** CIS §7.26 — auditor overview of software settings + fiscal DB state. */
  async getRraAuditOverview(branchId?: number | string) {
    const q = branchId != null && branchId !== "" ? `?branchId=${branchId}` : "";
    return this.request(`${this.rraBase()}/audit-overview${q}`);
  }

  /** CIS §7.28 — last finalized receipt for power/paper recovery reprint. */
  async getLastReceipt() {
    return this.request(`/sales/${this.getOrganizationId()}/last-receipt`);
  }

  /** POST /branches/saveBrancheUsers — push one CIS user/cashier to VSDC. */
  async syncUserToRra(userId: number | string) {
    return this.request(`${this.rraBase()}/users/${userId}/sync`, { method: "POST" });
  }

  /** POST /items/saveItemComposition — push one BOM component to VSDC. */
  async syncBomCompositionToRra(productId: number | string, componentId: number | string) {
    return this.request(
      `${this.rraBase()}/items/${productId}/composition/${componentId}/sync`,
      { method: "POST" },
    );
  }

  /** POST /ebm/initialize — one-time VSDC device init for a branch. */
  async initializeEbmDevice(body: { branchId?: number; dvcSrlNo?: string } = {}) {
    return this.request(`/organizations/${this.getOrganizationId()}/ebm/initialize`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** POST /z-report — submit the daily Z closing report to VSDC. */
  async submitVsdcZReport(body: { branchId?: number; rptDe?: string } = {}) {
    return this.request(`/organizations/${this.getOrganizationId()}/z-report`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** GET /z-report — last VSDC Z-report status for this org/branch. */
  async getVsdcZReportStatus(branchId?: number) {
    const q = branchId != null ? `?branchId=${branchId}` : "";
    return this.request(`/organizations/${this.getOrganizationId()}/z-report${q}`);
  }

  async exportReport(reportType: string, params: any) {
    const query = new URLSearchParams(params).toString();
    const response = await this.fetchWithRefresh(
      `${API_URL}/reports/export/${reportType}/${this.getOrganizationId()}?${query}`,
    );

    if (!response.ok) {
      throw new Error("Export failed");
    }

    const blob = await response.blob();
    return blob;
  }

  // System Owner endpoints
  async getSystemOwnerStats() {
    return this.request(`/system-owner/dashboard/stats/${this.getOrganizationId()}`);
  }

  async getAllPharmacies(params?: any) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/system-owner/pharmacies${query}`);
  }

  async updatePharmacyStatus(id: string, isActive: boolean) {
    return this.request(`/system-owner/pharmacies/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    });
  }

  async getAllSubscriptions(params?: any) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/system-owner/subscriptions${query}`);
  }

  async getRevenueAnalytics(period = "monthly") {
    return this.request(`/system-owner/analytics/revenue?period=${period}`);
  }

  // Subscription endpoints
  async getPharmacySubscription() {
    return this.request(`/subscriptions/organization/${this.getOrganizationId()}`);
  }

  async createSubscription(data: { planType: string }) {
    return this.request("/subscriptions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async renewSubscription(id: string, params?: { months?: number; billingMode?: "MONTHLY" | "YEARLY" }) {
    // NOTE: this hits the Stripe-only renewal path (subscription.controller.ts),
    // which isn't reachable from the app's real payment rails (Pesapal/Paypack).
    // The subscription-management renewal UI uses the Pesapal/Paypack initiate
    // endpoints instead (see initiatePesapalPayment / initiateMobilePayment),
    // which already treat "buy more months for an existing plan" as a renewal.
    const organizationId = this.getOrganizationId();
    return this.request(`/subscriptions/organizations/${organizationId}/subscriptions/${id}/renew`, {
      method: "POST",
      body: JSON.stringify(params || {}),
    });
  }

  // Payment endpoints
  async verifyPayment(id: string) {
    return this.request(`/payments/${id}/verify`, {
      method: "POST",
    });
  }
  // Supplier endpoints
  async getSuppliers(organizationId: string | number, params?: any) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    const response = await this.request(`/suppliers/${organizationId}${query}`);
    return Array.isArray(response) ? { suppliers: response } : response;
  }

  async createSupplier(organizationId: string | number, data: any) {
    return this.request(`/suppliers/${organizationId}`, {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateSupplier(id: string | number, data: any, organizationId?: string | number) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/suppliers/${org}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  }

  async deleteSupplier(id: string | number, organizationId?: string | number) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/suppliers/${org}/${id}`, {
      method: "DELETE",
    })
  }

  async deleteCustomer(id: string, organizationId?: string | number) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/customers/${id}/${org}`, {
      method: "DELETE",
    })
  }

  // Purchase Order endpoints
  async getPurchaseOrders(organizationId: string | number, params?: any) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : ""
    return this.request(`/purchase-orders/${organizationId}${query}`)
  }

  async createPurchaseOrder(organizationId: string | number, data: any) {
    return this.request(`/purchase-orders/${organizationId}`, {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updatePurchaseOrderStatus(
    id: string | number,
    status: string,
    organizationId?: string | number,
    options?: {
      branchId?: number | null;
      receivedItems?: Array<{
        productId: number;
        quantity?: number;
        unitCost?: number;
        batchNumber?: string;
        expiryDate?: string;
        sellingPrice?: number;
      }>;
    }
  ) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/purchase-orders/${org}/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        branchId: options?.branchId,
        receivedItems: options?.receivedItems,
      }),
    })
  }

  async getPurchaseOrder(id: string | number) {
    return this.request(`/purchase-orders/${id}`)
  }

  async deletePurchaseOrder(id: string | number, organizationId?: string | number) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/purchase-orders/${org}/${id}`, {
      method: "DELETE",
    })
  }

  async updatePurchaseOrder(organizationId: string | number, id: string | number, data: any) {
    return this.request(`/purchase-orders/${organizationId}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  }

  private stockTransferBranchQs(branchId?: number | null) {
    if (branchId === undefined || branchId === null) return "";
    return `?branchId=${branchId}`;
  }

  async getStockTransfers(organizationId?: string | number, branchId?: number | null) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/stock-transfers/${org}${this.stockTransferBranchQs(branchId)}`);
  }

  async createStockTransfer(
    organizationId: string | number,
    data: {
      fromBranchId: number;
      toBranchId: number;
      notes?: string;
      items: Array<{ productId: number; quantity: number }>;
    },
    branchId?: number | null
  ) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(`/stock-transfers/${org}${this.stockTransferBranchQs(branchId)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async approveStockTransfer(
    organizationId: string | number,
    id: number,
    branchId?: number | null
  ) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(
      `/stock-transfers/${org}/${id}/approve${this.stockTransferBranchQs(branchId)}`,
      { method: "POST" }
    );
  }

  async rejectStockTransfer(
    organizationId: string | number,
    id: number,
    branchId?: number | null
  ) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(
      `/stock-transfers/${org}/${id}/reject${this.stockTransferBranchQs(branchId)}`,
      { method: "POST" }
    );
  }

  async completeStockTransfer(
    organizationId: string | number,
    id: number,
    branchId?: number | null
  ) {
    const org = organizationId ?? this.getOrganizationId();
    return this.request(
      `/stock-transfers/${org}/${id}/complete${this.stockTransferBranchQs(branchId)}`,
      { method: "POST" }
    );
  }

  // In your api-client.ts or similar file

  // Record a debt payment
  async recordDebtPayment(saleId: string, data: {
    amount: number;
    paymentMethod?: string;
    reference?: string;
    notes?: string;
  }) {
    return this.request(`/debt-payments/${saleId}/${this.getOrganizationId()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Get payment history for a sale
  async getSalePaymentHistory(saleId: string) {
    return this.request(`/debt-payments/sale/${saleId}/${this.getOrganizationId()}`);
  }

  // Get payment history for a customer
  async getCustomerPaymentHistory(customerId: string) {
    return this.request(`/debt-payments/customer/${customerId}/${this.getOrganizationId()}`);
  }

  // Get outstanding debts
  async getOutstandingDebts() {
    return this.request(`/debt-payments/outstanding/${this.getOrganizationId()}`);
  }

  // Get all payment history with optional filters
  async getAllPaymentHistory(filters: {
    paymentMethod?: string;
    customerName?: string;
    recordedByName?: string;
    startDate?: string;
    endDate?: string;
  } = {}) {
    const queryParams = new URLSearchParams();

    if (filters.paymentMethod) queryParams.append('paymentMethod', filters.paymentMethod);
    if (filters.customerName) queryParams.append('customerName', filters.customerName);
    if (filters.recordedByName) queryParams.append('recordedByName', filters.recordedByName);
    if (filters.startDate) queryParams.append('startDate', filters.startDate);
    if (filters.endDate) queryParams.append('endDate', filters.endDate);

    const queryString = queryParams.toString();
    return this.request(`/debt-payments/all/${this.getOrganizationId()}${queryString ? '?' + queryString : ''}`);
  }

  async getOrganizationSubscriptions() {
    const organizationId = this.getOrganizationId();
    return this.request(`/subscriptions/organizations/${organizationId}/subscriptions`);
  };

  async getPaymentHistory() {
    const organizationId = this.getOrganizationId();
    const token = this.getToken();
    const response = this.request(
      `/subscriptions/organizations/${organizationId}/payments`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response;
  };

  async initiatePesapalPayment(planId: string, params?: { months?: number; billingMode?: "MONTHLY" | "YEARLY" }) {
    const organizationId = this.getOrganizationId();
    return this.request(`/subscriptions/organizations/${organizationId}/plans/${planId}/pesapal/initiate`, {
      method: "POST",
      body: JSON.stringify(params || {}),
    });
  };

  async verifyPesapalPayment(orderTrackingId: string, planId: string) {
    return this.request(`/pesapal/organizations/${this.getOrganizationId()}/plans/${planId}/transaction-status/${orderTrackingId}`);
  }

  async processPesapalWebhook(orderTrackingId: string, merchantReference: string) {
    return this.request(`/pesapal/callback`, {
      method: "POST",
      body: JSON.stringify({
        OrderTrackingId: orderTrackingId,
        OrderNotificationType: "CALLBACK",
        OrderMerchantReference: merchantReference
      }),
    });
  }
  async cancelSubscription(subscriptionId: string) {
    const organizationId = this.getOrganizationId();
    return this.request(`/subscriptions/organizations/${organizationId}/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
    });
  }
  async reactivateSubscription(subscriptionId: string) {
    const organizationId = this.getOrganizationId();
    return this.request(`/subscriptions/organizations/${organizationId}/subscriptions/${subscriptionId}/reactivate`, {
      method: "POST",
    });
  }

  // ============================================
  // Inventory Ledger Endpoints
  // ============================================

  /**
   * Add stock to inventory (Stock IN)
   * @param data Stock addition details
   */
  async addStockToInventory(data: {
    productId: number;
    quantity: number;
    movementType: 'PURCHASE' | 'RETURN_CUSTOMER' | 'TRANSFER_IN' | 'INITIAL_STOCK' | 'ADJUSTMENT_IN';
    warehouseId?: number | null;
    unitCost?: number;
    reference?: string;
    referenceType?: string;
    batchNumber?: string;
    expiryDate?: string;
    note?: string;
    metadata?: Record<string, any>;
  }) {
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/in`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Remove stock from inventory (Stock OUT)
   * @param data Stock removal details
   */
  async removeStockFromInventory(data: {
    productId: number;
    quantity: number;
    movementType: 'SALE' | 'DAMAGE' | 'EXPIRED' | 'TRANSFER_OUT' | 'ADJUSTMENT_OUT';
    warehouseId?: number | null;
    reference?: string;
    referenceType?: string;
    note?: string;
    metadata?: Record<string, any>;
  }) {
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/out`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Adjust stock (can be positive or negative)
   * @param data Stock adjustment details
   */
  async adjustInventoryStock(data: {
    productId: number;
    quantity: number; // Can be positive or negative
    branchId?: number | null;
    unitCost?: number;
    reference?: string;
    referenceType?: string;
    note?: string;
    metadata?: Record<string, any>;
  }) {
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/adjustment`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get ledger entries with filtering and pagination
   * @param params Filter and pagination parameters
   */
  async getInventoryLedger(params?: {
    productId?: number;
    warehouseId?: number | null;
    movementType?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const queryParams: Record<string, string> = {};
    if (params?.productId) queryParams.productId = params.productId.toString();
    if (params?.warehouseId !== undefined) {
      queryParams.warehouseId = params.warehouseId === null ? 'null' : params.warehouseId.toString();
    }
    if (params?.movementType) queryParams.movementType = params.movementType;
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.page) queryParams.page = params.page.toString();
    if (params?.limit) queryParams.limit = params.limit.toString();

    const query = Object.keys(queryParams).length > 0
      ? `?${new URLSearchParams(queryParams).toString()}`
      : '';
    return this.request(`/inventory/${this.getOrganizationId()}/ledger${query}`);
  }

  /**
   * Get inventory summary since inception or from a specific date
   * @param params Summary parameters
   */
  async getInventorySummary(params?: {
    productId?: number;
    branchId?: number | null;
    from?: 'inception' | string; // Date string or 'inception'
  }) {
    const queryParams: Record<string, string> = {};
    if (params?.productId) queryParams.productId = params.productId.toString();
    if (params?.branchId !== undefined) {
      queryParams.branchId = params.branchId === null ? 'null' : params.branchId.toString();
    }
    if (params?.from) queryParams.from = params.from;

    const query = Object.keys(queryParams).length > 0
      ? `?${new URLSearchParams(queryParams).toString()}`
      : '';
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/summary${query}`);
  }

  /**
   * Get current stock for a product (calculated from ledger)
   * @param productId Product ID
   * @param warehouseId Optional warehouse ID (null for main warehouse)
   */
  async getCurrentStock(productId: number, warehouseId?: number | null) {
    const query = warehouseId !== undefined
      ? `?warehouseId=${warehouseId === null ? 'null' : warehouseId}`
      : '';
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/current-stock/${productId}${query}`);
  }

  /**
   * Get complete inventory history for a product since inception
   * @param productId Product ID
   * @param warehouseId Optional warehouse ID (null for main warehouse)
   */
  async getInventoryHistory(productId: number, branchId?: number | null) {
    const query = branchId !== undefined
      ? `?branchId=${branchId === null ? 'null' : branchId}`
      : '';
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/history/${productId}${query}`);
  }

  /**
   * Recalculate product stock from ledger (useful for data integrity)
   * @param productId Product ID
   * @param warehouseId Optional warehouse ID (null for main warehouse)
   */
  async recalculateProductStock(productId: number, warehouseId?: number | null) {
    return this.request(`/inventory/${this.getOrganizationId()}/ledger/recalculate/${productId}`, {
      method: 'POST',
      body: JSON.stringify({ warehouseId: warehouseId === undefined ? null : warehouseId }),
    });
  }

  // ============================================
  // Warehouse Endpoints
  // ============================================

  /**
   * Get all warehouses for the organization
   */
  async getWarehouses(includeInactive: boolean = true) {
    const query = includeInactive ? '?includeInactive=true' : '';
    return this.request(`/warehouses/${this.getOrganizationId()}${query}`, {
      method: 'GET',
    });
  }

  /**
   * Get warehouse by ID
   * @param warehouseId Warehouse ID
   */
  async getWarehouseById(warehouseId: number) {
    return this.request(`/warehouses/${this.getOrganizationId()}/${warehouseId}`, {
      method: 'GET',
    });
  }

  /**
   * Create a new warehouse
   * @param data Warehouse data
   */
  async createWarehouse(data: {
    name: string;
    code?: string;
    address?: string;
    isDefault?: boolean;
  }) {
    return this.request(`/warehouses/${this.getOrganizationId()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update warehouse
   * @param warehouseId Warehouse ID
   * @param data Warehouse data
   */
  async updateWarehouse(warehouseId: number, data: {
    name?: string;
    code?: string;
    address?: string;
    isActive?: boolean;
    isDefault?: boolean;
  }) {
    return this.request(`/warehouses/${this.getOrganizationId()}/${warehouseId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete warehouse
   * @param warehouseId Warehouse ID
   */
  async deleteWarehouse(warehouseId: number) {
    return this.request(`/warehouses/${this.getOrganizationId()}/${warehouseId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Batch Management ====================

  /**
   * Get batches for a product
   */
  async getBatches(productId: number, warehouseId?: number | null, includeInactive?: boolean) {
    const params = new URLSearchParams();
    if (warehouseId !== undefined) params.append('warehouseId', warehouseId === null ? 'null' : warehouseId.toString());
    if (includeInactive) params.append('includeInactive', 'true');
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/batches/${this.getOrganizationId()}/product/${productId}${query}`);
  }

  /**
   * Get a single batch by ID
   */
  async getBatch(batchId: number) {
    return this.request(`/batches/${this.getOrganizationId()}/${batchId}`);
  }

  /**
   * Create a new batch
   */
  async createBatch(data: {
    productId: number;
    batchNumber: string;
    quantity: number;
    unitCost: number;
    expiryDate?: string;
    warehouseId?: number | null;
    reference?: string;
    referenceType?: string;
  }) {
    return this.request(`/batches/${this.getOrganizationId()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Select batches for sale (FIFO/LIFO/AVERAGE)
   */
  async selectBatches(data: {
    productId: number;
    quantity: number;
    method: 'FIFO' | 'LIFO' | 'AVERAGE';
    warehouseId?: number | null;
  }) {
    return this.request(`/batches/${this.getOrganizationId()}/select`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==================== Branch Management ====================

  /**
   * Get all branches
   */
  async getBranches(includeInactive?: boolean) {
    const query = includeInactive ? '?includeInactive=true' : '';
    return this.request(`/branches/${this.getOrganizationId()}${query}`);
  }

  /**
   * Get a single branch
   */
  async getBranch(branchId: number) {
    return this.request(`/branches/${this.getOrganizationId()}/${branchId}`);
  }

  /**
   * Get default branch
   */
  async getDefaultBranch() {
    return this.request(`/branches/${this.getOrganizationId()}/default`);
  }

  /**
   * Create a branch
   */
  async createBranch(data: {
    name: string;
    code?: string;
    address?: string;
    location?: string;
    phone?: string;
    isDefault?: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    return this.request(`/branches/${this.getOrganizationId()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update a branch
   */
  async updateBranch(branchId: number, data: {
    name?: string;
    code?: string;
    address?: string;
    location?: string;
    phone?: string;
    isDefault?: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
    // RRA EBM / VSDC per-branch credentials
    bhfId?: string;
    ebmDeviceId?: string;
    ebmSerialNo?: string;
    mrcNo?: string;
    vsdcUrl?: string;
  }) {
    return this.request(`/branches/${this.getOrganizationId()}/${branchId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branchId: number) {
    return this.request(`/branches/${this.getOrganizationId()}/${branchId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Set default branch
   */
  async setDefaultBranch(branchId: number) {
    return this.request(`/branches/${this.getOrganizationId()}/${branchId}/default`, {
      method: 'PUT',
    });
  }

  // ==================== Excel Imports ====================

  /**
   * Import customers from Excel
   */
  async importCustomers(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/customers/${this.getOrganizationId()}/import`, {
      method: 'POST',
      headers: {}, // Let browser set Content-Type with boundary
      body: formData,
    });
  }

  /**
   * Download customer import template
   */
  async downloadCustomerTemplate() {
    return this.requestFile(`/customers/${this.getOrganizationId()}/import/template`);
  }

  /**
   * Import suppliers from Excel
   */
  async importSuppliers(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/suppliers/${this.getOrganizationId()}/import`, {
      method: 'POST',
      headers: {}, // Let browser set Content-Type with boundary
      body: formData,
    });
  }

  /**
   * Download supplier import template
   */
  async downloadSupplierTemplate() {
    return this.requestFile(`/suppliers/${this.getOrganizationId()}/import/template`);
  }

  /**
   * Preview customer import - validates but does not save
   */
  async previewCustomerImport(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/customers/${this.getOrganizationId()}/import/preview`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Confirm customer import - saves valid records
   */
  async confirmCustomerImport(importId: string) {
    return this.request(`/customers/${this.getOrganizationId()}/import/confirm`, {
      method: 'POST',
      body: JSON.stringify({ importId }),
    });
  }

  /**
   * Download customer error file
   */
  async downloadCustomerErrorFile(importId: string) {
    return this.requestFile(`/customers/${this.getOrganizationId()}/import/errors/${importId}`);
  }

  /**
   * Preview supplier import - validates but does not save
   */
  async previewSupplierImport(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/suppliers/${this.getOrganizationId()}/import/preview`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Confirm supplier import - saves valid records
   */
  async confirmSupplierImport(importId: string) {
    return this.request(`/suppliers/${this.getOrganizationId()}/import/confirm`, {
      method: 'POST',
      body: JSON.stringify({ importId }),
    });
  }

  /**
   * Download supplier error file
   */
  async downloadSupplierErrorFile(importId: string) {
    return this.requestFile(`/suppliers/${this.getOrganizationId()}/import/errors/${importId}`);
  }

  // ==================== Profit Reports ====================

  /**
   * Get profit report for a date range
   */
  async getProfitReport(startDate: string, endDate: string, productId?: number) {
    const params = new URLSearchParams({
      startDate,
      endDate,
    });
    if (productId) params.append('productId', productId.toString());
    return this.request(`/reports/${this.getOrganizationId()}/profit?${params.toString()}`);
  }

  /**
   * Get profit summary for a sale
   */
  async getSaleProfitSummary(saleId: number) {
    return this.request(`/sales/${this.getOrganizationId()}/${saleId}/profit`);
  }

  // ==================== Expense Management ====================

  async createExpense(data: any) {
    return this.request(`/expenses/${this.getOrganizationId()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getExpenses(params?: any) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/expenses/${this.getOrganizationId()}${query}`);
  }

  async updateExpense(id: string | number, data: any) {
    return this.request(`/expenses/${this.getOrganizationId()}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteExpense(id: string | number) {
    return this.request(`/expenses/${this.getOrganizationId()}/${id}`, {
      method: 'DELETE',
    });
  }

  // ==================== Payroll ====================

  async getEmployees(status?: 'ACTIVE' | 'INACTIVE') {
    return this.request(`/payroll/${this.getOrganizationId()}/employees${status ? `?status=${status}` : ''}`);
  }

  async createEmployee(data: any) {
    return this.request(`/payroll/${this.getOrganizationId()}/employees`, { method: 'POST', body: JSON.stringify(data) });
  }

  async updateEmployee(id: number, data: any) {
    return this.request(`/payroll/${this.getOrganizationId()}/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async previewPayslip(data: { basicSalary: number; housingAllowance?: number; transportAllowance?: number; otherAllowance?: number }) {
    return this.request(`/payroll/${this.getOrganizationId()}/preview`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getPayrollRuns() {
    return this.request(`/payroll/${this.getOrganizationId()}/runs`);
  }

  async getPayrollRun(id: number) {
    return this.request(`/payroll/${this.getOrganizationId()}/runs/${id}`);
  }

  async createPayrollRun(data: { year: number; month: number; notes?: string }) {
    return this.request(`/payroll/${this.getOrganizationId()}/runs`, { method: 'POST', body: JSON.stringify(data) });
  }

  async payrollRunAction(id: number, action: 'recalculate' | 'cancel' | 'approve' | 'pay', data?: { paymentMethod: string }) {
    return this.request(`/payroll/${this.getOrganizationId()}/runs/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
  }

  // ==================== Supplier Payments ====================

  async recordSupplierPayment(data: any) {
    return this.request(`/supplier-payments/${this.getOrganizationId()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSupplierPayments(params?: any) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request(`/supplier-payments/${this.getOrganizationId()}${query}`);
  }

  // ==================== BOM & Production ====================

  async getBomComponents(organizationId: string | number, productId: number) {
    return this.request(`/inventory/${organizationId}/products/${productId}/bom`);
  }

  async addBomComponent(organizationId: string | number, productId: number, data: {
    componentProductId: number;
    quantity: number;
    unit: string;
  }) {
    return this.request(`/inventory/${organizationId}/products/${productId}/bom`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBomComponent(organizationId: string | number, productId: number, componentProductId: number, data: {
    quantity?: number;
    unit?: string;
  }) {
    return this.request(`/inventory/${organizationId}/products/${productId}/bom/${componentProductId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async removeBomComponent(organizationId: string | number, productId: number, componentProductId: number) {
    return this.request(`/inventory/${organizationId}/products/${productId}/bom/${componentProductId}`, {
      method: 'DELETE',
    });
  }

  async getBomCost(organizationId: string | number, productId: number) {
    return this.request(`/inventory/${organizationId}/products/${productId}/bom/cost`);
  }

  async checkProductionRequirements(organizationId: string | number, productId: number, params: {
    quantity: number;
    branchId: number;
  }) {
    const query = new URLSearchParams({
      quantity: params.quantity.toString(),
      branchId: params.branchId.toString(),
    }).toString();
    return this.request(`/inventory/${organizationId}/products/${productId}/production/requirements?${query}`);
  }

  async createProductionRun(organizationId: string | number, data: {
    branchId: number;
    productId: number;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
    note?: string;
  }) {
    return this.request(`/inventory/${organizationId}/production/runs`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getProductionRuns(organizationId: string | number, params?: {
    branchId?: number;
    productId?: number;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return this.request(`/inventory/${organizationId}/production/runs${query ? '?' + query : ''}`);
  }

  async getProductionRun(organizationId: string | number, runId: number) {
    return this.request(`/inventory/${organizationId}/production/runs/${runId}`);
  }

  async reverseProductionRun(organizationId: string | number, runId: number) {
    return this.request(`/inventory/${organizationId}/production/runs/${runId}/reverse`, {
      method: 'POST',
    });
  }

  // ==================== Tax Codes ====================

  async getTaxCodes(): Promise<Array<{ code: string; label: string; rate: number; category: string }>> {
    try {
      return await this.request(`/inventory/tax-codes?organizationId=${this.getOrganizationId()}`);
    } catch {
      return this.request('/inventory/tax-codes');
    }
  }

  // ==================== Image Upload ====================

  async uploadProductImage(file: File): Promise<{ imageUrl: string }> {
    const formData = new FormData();
    formData.append('image', file);
    const response = await this.fetchWithRefresh(
      `${API_URL}/upload/image`,
      { method: 'POST', body: formData },
    );
    if (!response.ok) {
      throw new Error('Image upload failed');
    }
    return response.json();
  }

  async updateProductImage(organizationId: string | number, productId: string | number, file?: File) {
    const formData = new FormData();
    if (file) formData.append('image', file);
    const response = await this.fetchWithRefresh(
      `${API_URL}/inventory/${organizationId}/product/${productId}/image`,
      { method: 'PUT', body: formData },
    );
    if (!response.ok) throw new Error('Failed to update product image');
    return response.json();
  }

  // ==================== Supplier Invoice Scanner ====================

  async scanInvoice(organizationId: string, file: File, onProgress?: (pct: number) => void, extractedData?: unknown): Promise<any> {
    const formData = new FormData();
    formData.append('invoice', file);
    if (extractedData) {
      formData.append('extractedData', JSON.stringify(extractedData));
    }

    const STALL_TIMEOUT_MS = 20_000; // no upload progress for this long → treat as stalled
    const TOTAL_TIMEOUT_MS = 120_000; // hard cap on the whole request (upload + server processing)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const branchParam = this.getBranchQueryParam();
      const sep = branchParam ? '?' : '';
      xhr.open('POST', `${API_URL}/supplier-invoices/${organizationId}/scan${sep}${branchParam}`);
      xhr.timeout = TOTAL_TIMEOUT_MS;

      const token = this.getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      let stallTimer: ReturnType<typeof setTimeout>;
      const resetStallTimer = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          xhr.abort();
        }, STALL_TIMEOUT_MS);
      };
      resetStallTimer();

      xhr.upload.onprogress = (e) => {
        resetStallTimer();
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        clearTimeout(stallTimer);
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data?.error || data?.message || 'Upload failed'));
          }
        } catch {
          reject(new Error('Invalid server response'));
        }
      };

      xhr.onerror = () => {
        clearTimeout(stallTimer);
        reject(new Error('Network error during upload'));
      };

      xhr.ontimeout = () => {
        clearTimeout(stallTimer);
        reject(new Error('The request took too long and timed out. Please try again with a smaller file or check your connection.'));
      };

      xhr.onabort = () => {
        clearTimeout(stallTimer);
        reject(new Error('Upload stalled and was cancelled. Please check your connection or try a smaller file.'));
      };

      xhr.send(formData);
    });
  }

  async getSupplierInvoices(organizationId: string, params?: { status?: string; page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.search) qs.set('search', params.search);
    if (params?.sortBy) qs.set('sortBy', params.sortBy);
    if (params?.sortOrder) qs.set('sortOrder', params.sortOrder);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/supplier-invoices/${organizationId}${query}`);
  }

  async getSupplierInvoice(organizationId: string, id: number | string) {
    return this.request(`/supplier-invoices/${organizationId}/${id}`);
  }

  async updateInvoiceItems(organizationId: string, id: number | string, payload: { items?: any[]; invoiceHeader?: any }) {
    return this.request(`/supplier-invoices/${organizationId}/${id}/items`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async matchInvoiceProducts(organizationId: string, items: Array<{ productName: string; barcode?: string; sku?: string }>) {
    return this.request(`/supplier-invoices/${organizationId}/match`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  async importInvoiceProducts(organizationId: string, id: number | string, itemActions: any[]) {
    return this.request(`/supplier-invoices/${organizationId}/${id}/import`, {
      method: 'POST',
      body: JSON.stringify({ itemActions }),
    });
  }

  async deleteSupplierInvoice(organizationId: string, id: number | string) {
    return this.request(`/supplier-invoices/${organizationId}/${id}`, {
      method: 'DELETE',
    });
  }
}

export interface OverviewDashboardData {
  currency: string;
  dateRange: {
    preset: string;
    startDate: string;
    endDate: string;
  };
  kpis: {
    totalSales: { value: number; prevValue: number; changePercentage: number; sparkline: number[] };
    transactions: { value: number; prevValue: number; changePercentage: number; sparkline: number[] };
    totalExpenses: { value: number; prevValue: number; changePercentage: number; sparkline: number[] };
    totalAlerts: { value: number; prevValue: number; changePercentage: number; sparkline: number[] };
  };
  branchPerformance: {
    hasActivity: boolean;
    branches: Array<{ branchId: number; name: string; sales: number; transactions: number; expenses: number }>;
  };
  salesOverview: Array<{ label: string; sales: number; expenses: number }>;
  topSellingProducts: Array<{ id: number; name: string; sold: number; revenue: number; percentage: number }>;
  stockAlerts: {
    lowStock: { count: number; label: string; subtext: string };
    expired: { count: number; label: string; subtext: string };
    outOfStock: { count: number; label: string; subtext: string };
  };
  recentActivities: Array<{
    id: string;
    title: string;
    subtext: string;
    timestamp: string;
    timeFormatted: string;
    type: 'sale' | 'payment' | 'stock' | 'user';
  }>;
}

export const apiClient = new ApiClient();
