import React, { useEffect, useState, Suspense } from "react";
import { toast } from "react-toastify";
import {
    Shield,
    XCircle,
    Package,
    Building2,
    Mail,
    GitBranch
} from "lucide-react";
import { Button } from "../../components/ui/button";

import { Skeleton } from "../../components/ui/skeleton";
import { apiClient } from "../../lib/api-client";

interface InvitationDetails {
    id: string;
    email: string;
    role: string;
    organization: {
        id: string;
        name: string;
        businessType: string;
        avatar?: string;
    };
    branch?: {
        id: number;
        name: string;
        code: string;
    } | null;
    invitedBy?: {
        name: string;
        email: string;
    };
    expiresAt: string;
}

interface AcceptInvitationContentProps {
    token: string | null;
    navigate: (path: string) => void;
}

const AcceptInvitationContent: React.FC<AcceptInvitationContentProps> = ({
    token,
    navigate,
}) => {
    const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [nameError, setNameError] = useState("");

    useEffect(() => {
        if (!token) {
            setError("Invalid invitation link");
            setLoading(false);
            return;
        }
        fetchInvitationDetails();
    }, [token]);

    const fetchInvitationDetails = async () => {
        try {
            setLoading(true);
            const data = await apiClient.getInvitationDetails(token!);
            setInvitation(data);
        } catch (err: any) {
            setError(err.message || "Failed to load invitation details");
            toast.error(err.message || "Failed to load invitation details");
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async () => {
        if (!name.trim()) {
            setNameError("Please enter your name");
            return;
        }

        try {
            setProcessing(true);
            await apiClient.acceptInvitation(token!, name);
            toast.success("Welcome aboard! Redirecting to login...");
            setTimeout(() => {
                navigate("/login");
            }, 1500);
        } catch (err: any) {
            toast.error(err.message || "Failed to accept invitation");
        } finally {
            setProcessing(false);
        }
    };

    const handleDecline = async () => {
        try {
            setProcessing(true);
            await apiClient.declineInvitation(token!);
            toast.info("Invitation declined");
            setTimeout(() => {
                navigate("/");
            }, 1500);
        } catch (err: any) {
            toast.error("Failed to decline invitation");
        } finally {
            setProcessing(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 space-y-6">
                    <div className="space-y-4 text-center">
                        <Skeleton className="h-10 w-10 rounded-lg mx-auto" />
                        <div className="space-y-2">
                            <Skeleton className="h-5 w-3/4 mx-auto" />
                            <Skeleton className="h-4 w-1/2 mx-auto" />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <Skeleton className="h-10 w-full rounded-lg" />
                        <Skeleton className="h-20 w-full rounded-lg" />
                        <Skeleton className="h-10 w-full rounded-lg" />
                    </div>
                </div>
            </div>
        );
    }

    if (error || !invitation) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-100 dark:border-red-900/20 p-6">
                    <div className="text-center pb-4">
                        <div className="mx-auto w-10 h-10 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-3">
                            <XCircle className="h-5 w-5 text-red-500" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Unable to Process Invitation</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {error || "This invitation link is invalid or has expired."}
                        </p>
                    </div>
                    <Button onClick={() => navigate("/")} variant="outline" className="w-full h-10 text-sm font-semibold rounded-lg">
                        Return Home
                    </Button>
                </div>
            </div>
        );
    }

    const isExpired = new Date(invitation.expiresAt) < new Date();

    return (
        <div
            className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat transition-all duration-500"
            style={{ backgroundImage: "url('/auth-bg.png')" }}
        >
            <div className="absolute inset-0 bg-blue-900/10 backdrop-blur-[2px]"></div>

            <div className="relative w-full max-w-[450px] mx-4">
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
                            Join the Team
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                            You've been invited to collabrate with {invitation.organization.name}.
                        </p>
                    </div>

                    <div className="p-6 pb-4">
                        <div className="flex items-center gap-4 mb-6">
                            {invitation.organization.avatar ? (
                                <img
                                    src={invitation.organization.avatar}
                                    alt={invitation.organization.name}
                                    className="h-12 w-12 rounded-lg object-cover border border-gray-100 dark:border-gray-700"
                                />
                            ) : (
                                <div className="h-12 w-12 rounded-lg bg-blue-600 flex items-center justify-center text-white text-lg font-bold">
                                    {invitation.organization.name.charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div className="flex-1">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-0.5">{invitation.organization.name}</h3>
                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <Building2 className="h-3.5 w-3.5" />
                                    <span className="capitalize">{invitation.organization.businessType.replace(/_/g, " ")}</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            {isExpired && (
                                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 flex items-start gap-3">
                                    <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                                    <div>
                                        <h4 className="text-xs font-semibold text-red-900 dark:text-red-200">Invitation Expired</h4>
                                        <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                                            This invitation link is no longer valid.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {!isExpired && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700/50">
                                        <div className="flex items-center gap-2 text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                                            <Shield className="h-3 w-3" />
                                            Role
                                        </div>
                                        <div className="font-semibold text-gray-900 dark:text-white capitalize text-xs">
                                            {invitation.role.replace(/_/g, " ")}
                                        </div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700/50">
                                        <div className="flex items-center gap-2 text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                                            <Mail className="h-3 w-3" />
                                            Email Address
                                        </div>
                                        <div className="font-semibold text-gray-900 dark:text-white truncate text-xs" title={invitation.email}>
                                            {invitation.email}
                                        </div>
                                    </div>
                                    {invitation.branch && (
                                        <div className="col-span-full p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20">
                                            <div className="flex items-center gap-2 text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-1 uppercase tracking-wider">
                                                <GitBranch className="h-3 w-3" />
                                                Branch Access
                                            </div>
                                            <div className="font-semibold text-blue-900 dark:text-blue-200 text-xs">
                                                {invitation.branch.name} ({invitation.branch.code})
                                            </div>
                                            <p className="text-[10px] text-blue-600/70 dark:text-blue-300/70 mt-0.5">
                                                Your access will be restricted to this branch
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label htmlFor="name" className="text-xs font-medium text-gray-700 dark:text-gray-200">
                                    Confirm your full name
                                </label>
                                <input
                                    id="name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        if (nameError) setNameError("");
                                    }}
                                    disabled={processing || isExpired}
                                    placeholder="e.g. John Doe"
                                    className={`flex h-10 w-full rounded-lg border bg-white dark:bg-gray-900 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${nameError
                                        ? "border-red-500"
                                        : "border-gray-300 dark:border-gray-600"
                                        }`}
                                />
                                {nameError && (
                                    <p className="text-[10px] text-red-500 font-medium flex items-center gap-1">
                                        <XCircle className="h-2.5 w-2.5" /> {nameError}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-row gap-3 pt-4 pb-2">
                            <Button
                                variant="outline"
                                onClick={handleDecline}
                                disabled={processing || isExpired}
                                className="flex-1 h-10 text-xs font-semibold rounded-lg"
                            >
                                Decline
                            </Button>
                            <Button
                                onClick={handleAccept}
                                disabled={processing || isExpired || !name.trim()}
                                className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-all active:scale-[0.99]"
                            >
                                {processing ? "Processing..." : "Accept Invitation"}
                            </Button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};

// Main Component Wrapper
export const AcceptInvitationPage: React.FC = () => {
    const [token] = useState<string | null>(
        new URLSearchParams(window.location.search).get("token")
    );

    const navigate = (path: string) => {
        window.location.href = path;
    };

    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                    <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 space-y-6">
                        <div className="space-y-4 text-center">
                            <Skeleton className="h-10 w-10 rounded-lg mx-auto" />
                            <Skeleton className="h-4 w-3/4 mx-auto" />
                        </div>
                        <div className="space-y-4">
                            <Skeleton className="h-24 w-full rounded-lg" />
                            <Skeleton className="h-10 w-full rounded-lg" />
                        </div>
                    </div>
                </div>
            }
        >
            <AcceptInvitationContent token={token} navigate={navigate} />
        </Suspense>
    );
};
