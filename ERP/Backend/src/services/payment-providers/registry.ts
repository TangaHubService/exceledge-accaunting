import { PaymentProvider } from './index';
import { CashPaymentProvider } from './cash.provider';
import { PaypackPaymentProvider } from './paypack.provider';
import { MtnMoMoPaymentProvider } from './mtn-momo.provider';

const providers = new Map<string, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
    providers.set(provider.name, provider);
}

export function getProvider(name: string): PaymentProvider | undefined {
    return providers.get(name);
}

export function getAllProviders(): PaymentProvider[] {
    return Array.from(providers.values());
}

export function getAvailableMethods(): string[] {
    return Array.from(providers.keys());
}

// Register default providers
registerProvider(new CashPaymentProvider());
registerProvider(new PaypackPaymentProvider());
registerProvider(new MtnMoMoPaymentProvider());

// Stripe provider can be added when Stripe is configured
// Flutterwave provider can be added when Flutterwave is configured
// Bank Transfer is handled as a manual method
