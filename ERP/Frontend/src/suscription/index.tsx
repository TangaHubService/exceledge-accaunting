import React, { useState } from 'react';
import { CreditCard, User, Mail, Phone, MapPin, Building, DollarSign, ShoppingCart, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function DPOPaymentPage() {
    const [formData, setFormData] = useState({
        amount: '',
        currency: 'USD',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        country: 'US',
        zip: '',
        description: '',
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const currencies = [
        { code: 'USD', symbol: '$', name: 'US Dollar' },
        { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
        { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling' },
        { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling' },
        { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
        { code: 'RWF', symbol: 'FRw', name: 'Rwandan Franc' },
    ];

    const countries = [
        { code: 'US', name: 'United States' },
        { code: 'KE', name: 'Kenya' },
        { code: 'TZ', name: 'Tanzania' },
        { code: 'UG', name: 'Uganda' },
        { code: 'ZA', name: 'South Africa' },
        { code: 'RW', name: 'Rwanda' },
        { code: 'NG', name: 'Nigeria' },
        { code: 'GH', name: 'Ghana' },
        { code: 'ET', name: 'Ethiopia' },
    ];

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
        setError('');
    };

    const validateForm = () => {
        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            setError('Please enter a valid amount');
            return false;
        }
        if (!formData.firstName || !formData.lastName) {
            setError('Please enter your full name');
            return false;
        }
        if (!formData.email || !formData.email.includes('@')) {
            setError('Please enter a valid email address');
            return false;
        }
        if (!formData.phone) {
            setError('Please enter your phone number');
            return false;
        }
        if (!formData.description) {
            setError('Please enter a payment description');
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Call your backend API to initiate payment
            const response = await fetch('/api/payment/initiate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: parseFloat(formData.amount),
                    orderId: `ORD-${Date.now()}`,
                    customer: {
                        firstName: formData.firstName,
                        lastName: formData.lastName,
                        email: formData.email,
                        phone: formData.phone,
                        address: formData.address,
                        city: formData.city,
                        country: formData.country,
                        zip: formData.zip,
                    },
                    description: formData.description,
                    currency: formData.currency,
                }),
            });

            const data = await response.json();

            if (data.success && data.paymentUrl) {
                setSuccess(true);
                // Redirect to DPO payment page
                setTimeout(() => {
                    window.location.href = data.paymentUrl;
                }, 1500);
            } else {
                setError(data.error || 'Failed to initiate payment');
            }
        } catch (err) {
            setError('Network error. Please try again.');
            console.error('Payment error:', err);
        } finally {
            setLoading(false);
        }
    };

    const getCurrencySymbol = () => {
        const currency = currencies.find(c => c.code === formData.currency);
        return currency ? currency.symbol : '$';
    };

    if (success) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Redirecting to Payment</h2>
                    <p className="text-gray-600 mb-4">Please wait while we redirect you to the secure payment page...</p>
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
                        <CreditCard className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">Secure Payment</h1>
                    <p className="text-gray-600">Complete your payment securely with DPO Pay</p>
                </div>

                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div>
                        {/* Payment Details Section */}
                        <div className="p-6 sm:p-8 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50">
                            <div className="flex items-center mb-4">
                                <ShoppingCart className="w-5 h-5 text-blue-600 mr-2" />
                                <h2 className="text-xl font-semibold text-gray-900">Payment Details</h2>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Amount *
                                    </label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="number"
                                            name="amount"
                                            value={formData.amount}
                                            onChange={handleInputChange}
                                            step="0.01"
                                            min="0"
                                            placeholder="0.00"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Currency *
                                    </label>
                                    <select
                                        name="currency"
                                        value={formData.currency}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        required
                                    >
                                        {currencies.map(currency => (
                                            <option key={currency.code} value={currency.code}>
                                                {currency.code} - {currency.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Payment Description *
                                </label>
                                <input
                                    type="text"
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    placeholder="What is this payment for?"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-white"
                                        required
                                />
                            </div>
                        </div>

                        {/* Customer Information Section */}
                        <div className="p-6 sm:p-8">
                            <div className="flex items-center mb-4">
                                <User className="w-5 h-5 text-blue-600 mr-2" />
                                <h2 className="text-xl font-semibold text-gray-900">Customer Information</h2>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        First Name *
                                    </label>
                                    <input
                                        type="text"
                                        name="firstName"
                                        value={formData.firstName}
                                        onChange={handleInputChange}
                                        placeholder="John"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Last Name *
                                    </label>
                                    <input
                                        type="text"
                                        name="lastName"
                                        value={formData.lastName}
                                        onChange={handleInputChange}
                                        placeholder="Doe"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Email Address *
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleInputChange}
                                            placeholder="john@example.com"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Phone Number *
                                    </label>
                                    <div className="relative w-full">
                                        <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400 flex-shrink-0" />
                                        <input
                                            type="tel"
                                            name="phone"
                                            value={formData.phone}
                                            onChange={handleInputChange}
                                            placeholder="+1234567890"
                                            className="w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Address
                                    </label>
                                    <div className="relative">
                                        <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="text"
                                            name="address"
                                            value={formData.address}
                                            onChange={handleInputChange}
                                            placeholder="123 Main Street"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        City
                                    </label>
                                    <div className="relative">
                                        <Building className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <input
                                            type="text"
                                            name="city"
                                            value={formData.city}
                                            onChange={handleInputChange}
                                            placeholder="New York"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Country
                                    </label>
                                    <select
                                        name="country"
                                        value={formData.country}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-white"
                                    >
                                        {countries.map(country => (
                                            <option key={country.code} value={country.code}>
                                                {country.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Zip/Postal Code
                                    </label>
                                    <input
                                        type="text"
                                        name="zip"
                                        value={formData.zip}
                                        onChange={handleInputChange}
                                        placeholder="10001"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="mx-6 sm:mx-8 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
                                <AlertCircle className="w-5 h-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="p-6 sm:p-8 bg-gray-50 border-t border-gray-200">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <CreditCard className="w-5 h-5 mr-2" />
                                        Pay {getCurrencySymbol()}{formData.amount || '0.00'}
                                    </>
                                )}
                            </button>

                            <p className="text-xs text-gray-500 text-center mt-4">
                                Your payment is secured by DPO Pay. All transactions are encrypted and secure.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Trust Badges */}
                <div className="mt-8 text-center">
                    <p className="text-sm text-gray-600 mb-4">Trusted by businesses across Africa</p>
                    <div className="flex items-center justify-center gap-4 flex-wrap">
                        <div className="bg-white px-4 py-2 rounded-lg shadow-sm">
                            <p className="text-xs font-semibold text-gray-700">🔒 SSL Encrypted</p>
                        </div>
                        <div className="bg-white px-4 py-2 rounded-lg shadow-sm">
                            <p className="text-xs font-semibold text-gray-700">✓ PCI Compliant</p>
                        </div>
                        <div className="bg-white px-4 py-2 rounded-lg shadow-sm">
                            <p className="text-xs font-semibold text-gray-700">🌍 15+ Countries</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}