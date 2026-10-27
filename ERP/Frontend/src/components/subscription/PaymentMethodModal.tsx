import { useState, useEffect } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '../ui/drawer';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Loader2, CreditCard, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import mtn from "../../assets/mtn.jpg";
import aitel from "../../assets/aitel.jpg";
import { PesapalPaymentForm } from './PesaplPaymentForm';
import { DurationSelector, calculateDurationTotal, type DurationValue } from './DurationSelector';

type PaymentStatus = 'idle' | 'processing' | 'pending' | 'success' | 'error';

interface PaymentMethodModalProps {
    isOpen: boolean;
    onClose: () => void;
    planId: string;
    planName: string;
    /** Monthly price for the plan — the server-authoritative total is Monthly Price x Number of Months (or the discounted yearly rate). */
    price: number;
    onPaymentInitiated: (paymentMethod: string, phoneNumber?: string, duration?: DurationValue) => void;
    isProcessing: boolean;
    paymentStatus?: PaymentStatus;
    error?: { title: string; message: string } | null;
    /** Current subscription's end date when this is a renewal — see DurationSelector. */
    currentExpiryDate?: Date | null;
}

type PaymentMethod = 'MTN' | 'AIRTEL' | 'CARD' | null;

export const PaymentMethodModal = ({
    isOpen,
    onClose,
    planId,
    planName,
    price,
    onPaymentInitiated,
    isProcessing,
    paymentStatus = 'idle',
    error: propError,
    currentExpiryDate = null,
}: PaymentMethodModalProps) => {
    const [error, setError] = useState<{ title: string; message: string } | null>(null);
    const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(null);
    const [phoneNumber, setPhoneNumber] = useState('07');
    const [duration, setDuration] = useState<DurationValue>({ months: 1, billingMode: 'MONTHLY' });
    const [localPaymentStatus, setLocalPaymentStatus] = useState<PaymentStatus>(paymentStatus);
    const [isLocalProcessing, setIsLocalProcessing] = useState(isProcessing);
    const total = calculateDurationTotal({ monthlyPrice: price, months: duration.months, billingMode: duration.billingMode });

    // Update local state when props change
    useEffect(() => {
        setLocalPaymentStatus(paymentStatus);
    }, [paymentStatus]);

    useEffect(() => {
        setIsLocalProcessing(isProcessing);
    }, [isProcessing]);

    // Handle PesaPal callback messages
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;

            if (event.data.type === 'pesapal:payment:success') {
                const { orderTrackingId } = event.data.data;
                setLocalPaymentStatus('success');
                // You can add additional success handling here
                console.log('Payment successful with tracking ID:', orderTrackingId);
            } else if (event.data.type === 'pesapal:payment:error') {
                setLocalPaymentStatus('error');
                setError({
                    title: 'Payment Error',
                    message: event.data.message || 'An error occurred during payment processing.'
                });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    // Update error state when prop changes
    useEffect(() => {
        if (propError) {
            setError(propError);
        }
    }, [propError]);

    const handlePayment = () => {
        if (selectedMethod === 'CARD') {
            setIsLocalProcessing(true);
            onPaymentInitiated('CARD', undefined, duration);
        } else if (selectedMethod && phoneNumber) {
            setIsLocalProcessing(true);
            onPaymentInitiated(selectedMethod, phoneNumber, duration);
        }
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (/^0[0-9]*$/.test(value) && value.length <= 10) {
            setPhoneNumber(value);
        }
    };

    const handleModalClose = () => {
        if (!isLocalProcessing) {
            onClose();
        }
    };
    // Reset form when modal is closed
    useEffect(() => {
        if (!isOpen) {
            setSelectedMethod(null);
            setPhoneNumber('07');
            setDuration({ months: 1, billingMode: 'MONTHLY' });
            setError(null);
        }
    }, [isOpen]);

    const renderLoadingContent = () => (
        <div className="text-center py-8">
            <div className="relative w-16 h-16 mx-auto mb-6">
                <Loader2 className="h-full w-full animate-spin text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Processing Payment</h3>
            <p className="text-muted-foreground mb-2">
                {selectedMethod === 'MTN' ? (
                    <>
                        Please complete the payment on your phone or dial{' '}
                        <span className="font-bold">*128*7*1#</span> to finish your payment.
                    </>
                ) : selectedMethod === 'AIRTEL' ? (
                    "Follow the instructions on your phone to complete the payment"
                ) : "Please complete the payment process..."}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
                This may take a moment to process. Please don't close this window.
            </p>
        </div>
    );

    const renderPaymentForm = () => {
        if (paymentStatus === 'success') {
            return (
                <div className="text-center space-y-6 py-4">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                        <CheckCircle2 className="h-10 w-10 text-green-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-medium">Payment Successful!</h3>
                        <p className="text-muted-foreground mt-1">
                            Your {planName} subscription has been activated.
                        </p>
                    </div>
                    <Button onClick={onClose} className="w-full">
                        Back to Dashboard
                    </Button>
                </div>
            );
        }

        if (localPaymentStatus === 'error') {
            return (
                <div className="text-center space-y-6 py-4">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                        <XCircle className="h-10 w-10 text-red-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-medium">
                            {error?.title || 'Payment Failed'}
                        </h3>
                        <p className="text-muted-foreground mt-1">
                            {error?.message || 'There was an error processing your payment. Please try again.'}
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={onClose}
                            className="flex-1"
                        >
                            Close
                        </Button>
                        <Button
                            onClick={() => {
                                setError(null);
                                setLocalPaymentStatus('idle');
                            }}
                            className="flex-1"
                        >
                            Try Again
                        </Button>
                    </div>
                </div>
            );
        }

        if (selectedMethod === 'CARD') {
            return (
                <div className="space-y-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedMethod(null)}
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to payment methods
                    </Button>
                    <PesapalPaymentForm
                        planId={planId}
                        amount={total}
                        months={duration.months}
                        billingMode={duration.billingMode}
                        onSuccess={() => {
                            setLocalPaymentStatus('success');
                        }}
                        onError={(error) => {
                            setError({
                                title: 'Payment Failed',
                                message: error || 'There was an error processing your payment.'
                            });
                        }}
                        onBack={() => setSelectedMethod(null)}
                    />
                </div>
            );
        }

        return (
            <div className="space-y-3 py-2">
                {/* Plan Summary */}
                <div className="text-center p-3 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                    <h3 className="font-semibold text-base text-gray-900">{planName}</h3>
                </div>

                {/* Duration + live total/date preview */}
                <DurationSelector
                    monthlyPrice={price}
                    value={duration}
                    onChange={setDuration}
                    disabled={isProcessing}
                    currentExpiryDate={currentExpiryDate}
                />

                {/* Payment Methods */}
                <div className="space-y-3">
                    <div>
                        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                            Select Payment Method
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { key: "MTN" as PaymentMethod, label: "MTN Mobile Money", icon: mtn, color: "yellow", type: "mobile" },
                                { key: "AIRTEL" as PaymentMethod, label: "Airtel Money", icon: aitel, color: "red", type: "mobile" },
                                { key: "CARD" as PaymentMethod, label: "Card Payment", icon: null, color: "blue", type: "card" },
                            ].map((item) => (
                                <button
                                    key={item.key}
                                    onClick={() => setSelectedMethod(item.key)}
                                    disabled={isProcessing}
                                    className={`
                                        relative border-2 rounded-xl h-22 sm:h-24 p-2 flex flex-col items-center justify-center transition-all duration-300
                                        ${selectedMethod === item.key
                                            ? "border-indigo-500 shadow-lg shadow-indigo-200 bg-indigo-50 scale-105"
                                            : "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md"
                                        }
                                        disabled:opacity-50 disabled:cursor-not-allowed
                                    `}
                                >
                                    {selectedMethod === item.key && (
                                        <div className="absolute -top-2 -right-2 bg-indigo-600 text-white rounded-full p-1.5 shadow-lg">
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                    )}
                                    <div className="h-8 w-8 flex items-center justify-center mb-1">
                                        {item.icon ? (
                                            <img
                                                src={item.icon}
                                                alt={item.label}
                                                className="object-contain w-full h-full"
                                            />
                                        ) : (
                                            <CreditCard className="h-6 w-6 text-indigo-600" />
                                        )}
                                    </div>
                                    <span className="text-xs font-semibold text-center text-gray-700 leading-tight">{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {(selectedMethod === 'MTN' || selectedMethod === 'AIRTEL') && (
                        <div className="space-y-2 pt-2 pb-2 px-3 bg-gray-50 rounded-lg border border-gray-200">
                            <Label htmlFor="phone" className="text-sm font-semibold text-gray-700">Phone Number</Label>
                            <div className="relative w-full">
                                <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
                                    <span className="text-gray-500 text-xs sm:text-sm whitespace-nowrap">🇷🇼 +25</span>
                                </div>
                                <Input
                                    id="phone"
                                    type="tel"
                                    value={phoneNumber}
                                    onChange={handlePhoneChange}
                                    placeholder="07XXXXXXXX"
                                    className="pl-16 sm:pl-16 h-10 w-full border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                                    disabled={isProcessing}
                                />
                            </div>
                            <p className="text-xs text-gray-600 flex items-start sm:items-center gap-1">
                                <svg className="w-4 h-4 flex-shrink-0 mt-0.5 sm:mt-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                <span className="break-words">You'll receive a payment request on this number</span>
                            </p>
                        </div>
                    )}

                    <Button
                        className={`
                            w-full mt-4 h-10 text-sm font-semibold transition-all duration-300
                            ${selectedMethod
                                ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl"
                                : "bg-gray-300"
                            }
                        `}
                        onClick={handlePayment}
                        disabled={
                            isProcessing ||
                            !selectedMethod ||
                            ((selectedMethod as PaymentMethod) !== 'CARD' && (!phoneNumber || phoneNumber.length < 10))
                        }
                    >
                        {isProcessing ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Processing Payment...
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                Pay {total.toLocaleString()} RWF Securely
                            </div>
                        )}
                    </Button>

                    {/* Security Badge */}
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mt-3">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Secure payment powered by industry-leading encryption
                    </div>
                </div>
            </div>
        );
    };

    return (
        <Drawer open={isOpen} onOpenChange={(open) => !open && handleModalClose()}>
            <DrawerContent
                className="sm:max-w-md bg-white overflow-y-auto !p-4"
                onInteractOutside={(e) => {
                    e.preventDefault();
                }}
                onEscapeKeyDown={(e) => {
                    e.preventDefault();
                }}
            >
                {paymentStatus === 'processing' || paymentStatus === 'pending' ? (
                    renderLoadingContent()
                ) : (
                    <>
                        <DrawerHeader>
                            <DrawerTitle className="text-center text-lg">
                                {paymentStatus === 'success' ? 'Payment Successful' :
                                    paymentStatus === 'error' ? 'Payment Failed' : 'Select Payment Method'}
                            </DrawerTitle>
                        </DrawerHeader>
                        {renderPaymentForm()}
                    </>
                )}
            </DrawerContent>
        </Drawer>
    );
};