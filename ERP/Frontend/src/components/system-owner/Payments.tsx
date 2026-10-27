import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { CheckCircle, XCircle, Clock, Ban, Download, Mail, Loader2 } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { saveAs } from 'file-saver';
import type { Payment } from '../../services/systemOwnerService';
import InvoicePDF, { type BillingPayment } from '../invoice/InvoicePDF';
import type { Profile } from '../../types';

interface PaymentsProps {
  payments: Payment[];
  isLoading: boolean;
  error: string | null;
  onUpdatePaymentStatus: (id: string | number, status: string) => Promise<void>;
  onResendInvoice?: (id: string | number) => Promise<void>;
}

const Payments: React.FC<PaymentsProps> = ({ payments, isLoading, error, onUpdatePaymentStatus, onResendInvoice }) => {
  const [updatingId, setUpdatingId] = useState<string | number | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | number | null>(null);
  const [resendingId, setResendingId] = useState<string | number | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <XCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-RW', {
      style: 'currency',
      currency: 'RWF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { color: string; icon: React.ReactNode } } = {
      COMPLETED: {
        color: 'bg-green-100 text-green-800',
        icon: <CheckCircle className="h-4 w-4 mr-1" />,
      },
      PENDING: {
        color: 'bg-yellow-100 text-yellow-800',
        icon: <Clock className="h-4 w-4 mr-1" />,
      },
      FAILED: {
        color: 'bg-red-100 text-red-800',
        icon: <XCircle className="h-4 w-4 mr-1" />,
      },
    };

    const statusConfig = statusMap[status] || {
      color: 'bg-gray-100 text-gray-800',
      icon: null,
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}
      >
        {statusConfig.icon}
        {status.charAt(0) + status.slice(1).toLowerCase()}
      </span>
    );
  };

  const buildInvoiceData = (payment: Payment) => {
    const billingPayment: BillingPayment = {
      id: String(payment.id),
      amount: payment.amount,
      currency: payment.currency || 'RWF',
      status: payment.status as BillingPayment['status'],
      paymentMethod: payment.paymentMethod,
      createdAt: payment.createdAt,
      metadata: payment.metadata,
      subscription: {
        plan: {
          name: payment.subscription?.plan?.name || 'Subscription',
          price: payment.subscription?.plan?.price,
          currency: payment.subscription?.plan?.currency,
        },
        startDate: payment.subscription?.startDate || undefined,
        endDate: payment.subscription?.endDate || undefined,
        autoRenew: payment.subscription?.autoRenew,
      },
    };

    const orgProfile: Profile = {
      id: String(payment.subscription?.organization?.id ?? payment.id),
      name: payment.subscription?.organization?.name || 'N/A',
      email: payment.subscription?.organization?.email || 'N/A',
      phone: payment.subscription?.organization?.phone || undefined,
    };

    return { billingPayment, orgProfile };
  };

  const handleDownloadInvoice = async (payment: Payment) => {
    const { billingPayment, orgProfile } = buildInvoiceData(payment);
    setDownloadingId(payment.id);
    try {
      const blob = await pdf(<InvoicePDF payment={billingPayment} profile={orgProfile} />).toBlob();
      saveAs(blob, `invoice-${payment.id}.pdf`);
      toast.success(`Invoice ${payment.id} downloaded`);
    } catch (err) {
      console.error('Failed to generate invoice:', err);
      toast.error('Failed to generate invoice');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleResendInvoice = async (payment: Payment) => {
    if (!onResendInvoice) return;
    setResendingId(payment.id);
    try {
      await onResendInvoice(payment.id);
      toast.success('Invoice resent to subscriber email');
    } catch (err: any) {
      console.error('Failed to resend invoice:', err);
      toast.error(err?.message || 'Failed to resend invoice');
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Payments</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">View and manage payment history.</p>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Organization
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Paid On
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-4 text-gray-500 dark:text-gray-400">
                    No payments found
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      #{payment.id}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {payment.subscription?.organization?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-white font-medium">
                        {formatCurrency(payment.amount)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(payment.status)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {new Date(payment.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {payment.processedAt || payment.metadata?.processedAt ? (
                        new Date(payment.processedAt || payment.metadata.processedAt).toLocaleDateString()
                      ) : payment.status === 'COMPLETED' ? (
                        new Date(payment.updatedAt).toLocaleDateString()
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">Not paid</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleDownloadInvoice(payment)}
                          disabled={downloadingId === payment.id}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                          title="Download invoice"
                        >
                          {downloadingId === payment.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          Download
                        </button>
                        {onResendInvoice && (
                          <button
                            onClick={() => handleResendInvoice(payment)}
                            disabled={resendingId === payment.id}
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:opacity-50"
                            title="Resend invoice to subscriber email"
                          >
                            {resendingId === payment.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Mail className="h-3.5 w-3.5" />
                            )}
                            Resend
                          </button>
                        )}
                        {payment.status === 'PENDING' && (
                          <>
                            <button
                              onClick={async () => { setUpdatingId(payment.id); await onUpdatePaymentStatus(payment.id, 'COMPLETED'); setUpdatingId(null); }}
                              disabled={updatingId === payment.id}
                              className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 disabled:opacity-50"
                              title="Mark as Paid"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Paid
                            </button>
                            <button
                              onClick={async () => { setUpdatingId(payment.id); await onUpdatePaymentStatus(payment.id, 'FAILED'); setUpdatingId(null); }}
                              disabled={updatingId === payment.id}
                              className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                              title="Mark as Failed"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Fail
                            </button>
                            <button
                              onClick={async () => { setUpdatingId(payment.id); await onUpdatePaymentStatus(payment.id, 'CANCELED'); setUpdatingId(null); }}
                              disabled={updatingId === payment.id}
                              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300 disabled:opacity-50"
                              title="Cancel"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Payments;
