import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api-client';


interface PesapalPaymentFormProps {
    planId: string;
    amount: number;
    months?: number;
    billingMode?: 'MONTHLY' | 'YEARLY';
    onSuccess: (data: any) => void;
    onError: (error: string) => void;
    onBack: () => void;
}

export const PesapalPaymentForm = ({
    planId,
    amount,
    months = 1,
    billingMode = 'MONTHLY',
    onSuccess,
    onError,
    onBack,
}: PesapalPaymentFormProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isIframeLoading, setIsIframeLoading] = useState(true);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const response = await apiClient.initiatePesapalPayment(planId, { months, billingMode });
            if (response.success && response.data.redirect_url) {
                setIframeUrl(response.data.redirect_url);
            } else {
                onError('Failed to initialize PesaPal payment');
            }
        } catch (error) {
            console.error('PesaPal payment error:', error);
            onError('Failed to process payment. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleIframeMessage = (event: MessageEvent) => {
        // Verify the origin of the message for security
        if (event.origin !== window.location.origin) return;

        if (event.data.type === 'pesapal:payment:success') {
            onSuccess(event.data.data);
        } else if (event.data.type === 'pesapal:payment:error') {
            onError(event.data.message || 'Payment failed');
        }
    };

    useEffect(() => {
        window.addEventListener('message', handleIframeMessage);
        return () => {
            window.removeEventListener('message', handleIframeMessage);
        };
    }, []);

    if (iframeUrl) {
        return (
            <div className="space-y-4">
                <div className="relative w-full h-[500px] border rounded-lg overflow-hidden">
                    {isIframeLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    )}
                    <iframe
                        src={iframeUrl}
                        className={`w-full h-full border-0 ${isIframeLoading ? 'opacity-0' : 'opacity-100'}`}
                        onLoad={() => setIsIframeLoading(false)}
                        title="PesaPal Payment"
                    />
                </div>
                <div className="flex justify-end">
                    <Button variant="outline" onClick={onBack}>
                        Back
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label>Amount to Pay</Label>
                <Input
                    type="text"
                    value={`${amount.toLocaleString()} RWF`}
                    disabled
                    className="font-medium"
                />
            </div>

            <div className="text-sm text-muted-foreground">
                You will be redirected to a secure PesaPal payment page to complete your purchase.
            </div>

            <div className="flex justify-between pt-4">
                <Button type="button" variant="outline" onClick={onBack} disabled={isLoading}>
                    Back
                </Button>
                <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Proceed
                </Button>
            </div>
        </form>
    );
};