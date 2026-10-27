import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { useNavigate, Link } from "react-router-dom";
import { Package, Eye, EyeOff, Loader2 } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { signUpSchema } from "../../schema/auth";
import PhoneInputWithCountryCode from "../../components/PhoneInputWithCountryCode";

type FormData = yup.InferType<typeof signUpSchema>;

export default function SignupPage() {
    const navigate = useNavigate();
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const {
        register,
        handleSubmit,
        formState: { errors },
        control,
    } = useForm<FormData>({
        resolver: yupResolver(signUpSchema),
        defaultValues: {
            name: '',
            email: '',
            phone: '',
            password: '',
            confirmPassword: ''
        },
    });

    const showToast = (message: string, type: "error" | "success") => {
        if (type === "error") {
            setError(message);
            setSuccess("");
        } else {
            setSuccess(message);
            setError("");
        }
        // Auto-clear after 5 seconds
        setTimeout(() => {
            setError("");
            setSuccess("");
        }, 5000);
    };

    const onSubmit = async (data: FormData) => {
        setError("");
        setSuccess("");

        setIsLoading(true);

        try {
            await apiClient.signup({
                name: data.name,
                email: data.email,
                password: data.password,
                phone: data.phone
            });
            showToast("Account created! Please verify your account", "success");
            setTimeout(() => {
                navigate("/verify");
            }, 1000);
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : "Failed to create account",
                "error"
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat py-12 px-4 transition-all duration-500"
            style={{ backgroundImage: "url('/auth-bg.png')" }}
        >
            <div className="absolute inset-0 bg-blue-900/10 backdrop-blur-[2px]"></div>

            <div className="relative w-full max-w-[700px]">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                                <Package className="h-6 w-6 text-white" />
                            </div>
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                                Excledge
                            </h1>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            Create Account
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Sign up to start managing your inventory with Excledge.
                        </p>
                    </div>

                    <div className="p-6">
                        {error && (
                            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
                            </div>
                        )}
                        {success && (
                            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                <p className="text-xs text-green-600 dark:text-green-400 font-medium">{success}</p>
                            </div>
                        )}

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                        First Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="John"
                                        {...register('name')}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                        disabled={isLoading}
                                    />
                                    {errors.name && <p className="text-xs text-red-500 font-medium mt-1">{errors.name.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                        Last Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Doe"
                                        {...register('lastName')}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                        Email Address *
                                    </label>
                                    <input
                                        type="email"
                                        placeholder="you@example.com"
                                        {...register('email')}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                        disabled={isLoading}
                                    />
                                    {errors.email && <p className="text-xs text-red-500 font-medium mt-1">{errors.email.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                        Phone Number *
                                    </label>
                                    <Controller
                                        name="phone"
                                        control={control}
                                        render={({ field: { onChange, value }, fieldState: { error } }) => (
                                            <PhoneInputWithCountryCode
                                                value={value}
                                                onChange={(phoneNumber: string, countryCode: string) => {
                                                    const fullNumber = phoneNumber.startsWith(countryCode)
                                                        ? phoneNumber
                                                        : `${countryCode}${phoneNumber.replace(/^\+?\d*/, '')}`;
                                                    onChange(fullNumber);
                                                }}
                                                placeholder="Enter phone number"
                                                className={`w-full overflow-hidden border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm`}
                                                disabled={isLoading}
                                                error={error?.message}
                                            />
                                        )}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                        Password *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="••••••••"
                                            {...register('password')}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                            onClick={() => setShowPassword(!showPassword)}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {errors.password && <p className="text-xs text-red-500 font-medium mt-1">{errors.password.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                        Confirm Password *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showConfirmPassword ? 'text' : 'password'}
                                            placeholder="••••••••"
                                            {...register('confirmPassword')}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        >
                                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {errors.confirmPassword && <p className="text-xs text-red-500 font-medium mt-1">{errors.confirmPassword.message}</p>}
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed mt-2 text-sm"
                            >
                                {isLoading ? (
                                    <div className="flex items-center justify-center">
                                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                                        Creating Account...
                                    </div>
                                ) : (
                                    'Create Account'
                                )}
                            </button>

                            <div className="text-center pt-2">
                                <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                                    Already have an account?{' '}
                                    <Link
                                        to="/login"
                                        className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                                    >
                                        Sign in
                                    </Link>
                                </p>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}