import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { apiClient } from "../../lib/api-client";
import * as yup from "yup";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Package } from "lucide-react";

const forgotPasswordSchema = yup.object().shape({
    email: yup.string().email("Invalid email").required("Email is required"),
});

const COOLDOWN_MINUTES = 5;

export default function ForgotPasswordPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [cooldownRemaining, setCooldownRemaining] = useState(0);
    const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        return () => {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
        };
    }, []);

    const startCooldown = () => {
        setCooldownRemaining(COOLDOWN_MINUTES * 60);
        cooldownRef.current = setInterval(() => {
            setCooldownRemaining((prev) => {
                if (prev <= 1) {
                    if (cooldownRef.current) clearInterval(cooldownRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const formatCooldown = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm({
        resolver: yupResolver(forgotPasswordSchema),
    });

    const showToast = (message: string, type: "error" | "success") => {
        if (type === "error") {
            setError(message);
            setSuccess("");
        } else {
            setSuccess(message);
            setError("");
        }
        setTimeout(() => {
            setError("");
            setSuccess("");
        }, 5000);
    };

    const onSubmit = async (data: { email: string }) => {
        setIsLoading(true);
        setError("");
        setSuccess("");
        try {
            await apiClient.requestPasswordReset({
                email: data.email,
            });

            showToast(
                "A password reset link has been sent to your email",
                "success"
            );
            startCooldown();
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || "Failed to process your request";
            showToast(msg, "error");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat transition-all duration-500"
            style={{ backgroundImage: "url('/auth-bg.png')" }}
        >
            <div className="absolute inset-0 bg-blue-900/10 backdrop-blur-[2px]"></div>

            <div className="relative w-full max-w-[400px] mx-4">
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
                            Reset Password
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                            Enter your email address to reset your password.
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
                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                                    Email Address
                                </label>
                                <input
                                    type="email"
                                    placeholder="name@company.com"
                                    {...register("email")}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                />
                                {errors.email && (
                                    <p className="text-xs text-red-500 font-medium">
                                        {errors.email.message}
                                    </p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading || cooldownRemaining > 0}
                                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                                {isLoading ? (
                                    <div className="flex items-center justify-center">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Sending...
                                    </div>
                                ) : cooldownRemaining > 0 ? (
                                    `Resend in ${formatCooldown(cooldownRemaining)}`
                                ) : (
                                    "Send Reset Link"
                                )}
                            </button>

                            <div className="text-center pt-2">
                                <Link
                                    to="/login"
                                    className="inline-flex items-center text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
                                >
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    Back to Login
                                </Link>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}