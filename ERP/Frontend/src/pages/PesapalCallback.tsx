// src/pages/PesapalCallback.tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { apiClient } from '../lib/api-client';

type PaymentStatus = 'idle' | 'checking' | 'success' | 'error' | 'pending';

const notifyEmbeddingParent = (message: Record<string, unknown>) => {
    if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, window.location.origin);
    }
    window.opener?.postMessage(message, window.location.origin);
};

export const PesapalCallback = () => {
    const location = useLocation();
    const [status, setStatus] = useState<PaymentStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [transaction, setTransaction] = useState<any>(null);
    const navigate = useNavigate();

    // Progress bar for redirect countdown
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let hasRun = false;

        const checkPaymentStatus = async () => {
            const params = new URLSearchParams(location.search);
            const orderTrackingId = params.get('OrderTrackingId');
            const planId = params.get('planId');

            if (!orderTrackingId) {
                setError('No order tracking ID found');
                setStatus('error');
                return;
            }

            setStatus('checking');

            try {
                const response = await apiClient.verifyPesapalPayment(orderTrackingId, planId!);

                if (response.success) {
                    const transactionData = response.data;
                    setTransaction(transactionData);

                    if (transactionData.payment_status_description === 'Completed') {
                        try {
                            await apiClient.processPesapalWebhook(
                                orderTrackingId,
                                transactionData.merchant_reference
                            );
                        } catch (webhookError) {
                            console.error('Error processing webhook:', webhookError);
                        }
                    }

                    // Notify parent window
                    const messageType =
                        transactionData.payment_status_description === 'Completed'
                            ? 'pesapal:payment:success'
                            : 'pesapal:payment:error';

                    notifyEmbeddingParent({
                        type: messageType,
                        data: {
                            orderTrackingId,
                            transaction: transactionData
                        }
                    });

                    // If success, start progress redirect
                    if (transactionData.payment_status_description === 'Completed') {
                        setStatus('success');
                        return; // The progress bar logic will handle redirect
                    }

                    setStatus('error');
                } else {
                    throw new Error('Failed to verify payment status');
                }
            } catch (err) {
                console.error('Error checking payment status:', err);
                setError('Failed to verify payment status. Please check your order history or contact support.');
                setStatus('error');

                notifyEmbeddingParent({
                    type: 'pesapal:payment:error',
                    message: 'Failed to verify payment status'
                });
            }
        };

        if (!hasRun) {
            hasRun = true;
            checkPaymentStatus();
        }
    }, [location.search]);


    /**
     * ▶ Start Redirect Countdown when SUCCESS
     * Runs 3 seconds and updates progress from 0 → 100%
     */
    useEffect(() => {
        if (status !== 'success') return;

        let value = 0;
        const interval = setInterval(() => {
            value += 2; // Speed of progress bar
            setProgress(value);
        }, 60);

        // Redirect after 3 seconds
        const timeout = setTimeout(() => {
            const frontendUrl = import.meta.env.VITE_APP_URL || window.location.origin;
            const dashboardUrl = new URL('/dashboard', frontendUrl).href;

            if (window.top && window.top !== window.self) {
                window.top.location.href = dashboardUrl;
            } else if (window.opener) {
                window.opener.location.href = dashboardUrl;
                window.close();
            } else {
                navigate('/dashboard');
            }
        }, 3000);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [status]);


    const handleClose = () => window.close();



    if (status === 'checking' || status === 'idle') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
                <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-md w-full">
                    <div className="relative w-24 h-24 mx-auto mb-6">
                        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-ping opacity-20"></div>
                        <div className="relative bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full p-6">
                            <Loader2 className="h-12 w-12 animate-spin text-white" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                        Processing Payment
                    </h2>
                    <p className="text-gray-600 mb-4">
                        Please wait while we verify your payment...
                    </p>
                </div>
            </div>
        );
    }


    /**
     * 🎉 SUCCESS SCREEN WITH PROGRESS BAR
     */
    if (status === 'success' && transaction) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
                <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-lg w-full">
                    <div className="relative mb-6">
                        <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-20"></div>
                        <div className="relative bg-gradient-to-r from-green-500 to-emerald-500 p-6 rounded-full mx-auto w-24 h-24 flex items-center justify-center">
                            <CheckCircle2 className="h-12 w-12 text-white animate-bounce" />
                        </div>
                    </div>

                    <h2 className="text-3xl font-bold mb-3 bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                        Payment Successful! 🎉
                    </h2>

                    <p className="text-gray-600 mb-2 text-lg">
                        Thank you for your payment of{" "}
                        <span className="font-bold text-green-600">
                            {transaction.amount} {transaction.currency}
                        </span>
                    </p>

                    <p className="text-gray-700 font-medium mb-6">
                        Redirecting you to your dashboard...
                    </p>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                            className="h-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 transition-all duration-75"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>

                    <p className="mt-3 text-sm text-gray-600">
                        {Math.min(Math.floor(progress), 100)}%
                    </p>
                </div>
            </div>
        );
    }


    /**
     * ❌ ERROR SCREEN
     */
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50">
            <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-lg w-full">
                <div className="relative mb-6">
                    <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20"></div>
                    <div className="relative bg-gradient-to-r from-red-500 to-orange-500 p-6 rounded-full mx-auto w-24 h-24 flex items-center justify-center">
                        <XCircle className="h-12 w-12 text-white" />
                    </div>
                </div>

                <h2 className="text-3xl font-bold mb-3 text-gray-900">
                    {transaction?.payment_status_description === 'FAILED'
                        ? 'Payment Failed'
                        : 'Payment Processing'}
                </h2>

                {error ? (
                    <p className="text-gray-600 mb-6 text-lg">{error}</p>
                ) : (
                    <p className="text-gray-600 mb-6">
                        {transaction?.description || 'There was an issue processing your payment.'}
                    </p>
                )}

                <div className="flex flex-col sm:flex-row gap-3 w-full">
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        className="flex-1 h-12 border-2 border-gray-300 hover:border-gray-400"
                    >
                        Close
                    </Button>
                    <Button
                        onClick={() => window.location.reload()}
                        className="flex-1 h-12 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                    >
                        Try Again
                    </Button>
                </div>
            </div>
        </div>
    );
};
