import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSubscription } from "../context/SubscriptionContext";
import { PricingCard } from "../components/landing/PricingCard";
import { subscriptionService } from "../services/subscriptionService";
import { PaymentMethodModal } from "../components/subscription/PaymentMethodModal";
import type { DurationValue } from "../components/subscription/DurationSelector";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../components/ui/drawer";
import { io, Socket } from "socket.io-client";
import { toast } from "react-toastify";

type SubscriptionPageProps = {
    /** When false, only the plan grid is shown (e.g. landing page already has a title). */
    showPlanHeader?: boolean;
    /**
     * When set, auto-opens the payment modal for this plan on mount — used by
     * the Renew action on SubscriptionManagementPage so renewal reuses the
     * exact same duration + payment flow as a new purchase (the backend's
     * preparePurchase already treats "buy more months for a plan you already
     * have" as a renewal-in-place, so no separate renewal codepath is needed).
     */
    preselectedPlanId?: string | number | null;
    /** The current subscription's end date, shown in the duration preview as "Current Expiry -> New Expiry" instead of "Start -> End" when renewing. */
    renewalCurrentExpiryDate?: string | Date | null;
};

const SubscriptionPage = ({ showPlanHeader = true, preselectedPlanId = null, renewalCurrentExpiryDate = null }: SubscriptionPageProps) => {
    const { t } = useTranslation();
    const { plans, isLoading, refreshSubscription } = useSubscription();
    const [selectedPlan, setSelectedPlan] = useState<any>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState<
        "idle" | "processing" | "success" | "error"
    >("idle");

    const [paymentRef, setPaymentRef] = useState<string | null>(null);

    const [showPaymentResult, setShowPaymentResult] = useState(false);
    const [paymentResult, setPaymentResult] = useState({
        success: false,
        message: "",
        transactionId: "",
    });

    const socketRef = useRef<Socket | null>(null);
    const navigate = useNavigate();
    const organizationId = localStorage.getItem("current_organization_id");

    // -----------------------------------------------------
    // 🟣 WebSocket Handlers
    // -----------------------------------------------------
    const onConnect = useCallback(() => {
        if (!socketRef.current) return;
        console.log("🔌 WebSocket connected:", socketRef.current.id);

        if (organizationId) {
            socketRef.current.emit("joinOrganization", { organizationId }, () => {
                console.log(`✅ Joined organization room: org-${organizationId}`);
            });
        }
        if (paymentRef) {
            socketRef.current.emit("joinTransaction", { ref: paymentRef }, () => {
                console.log(`✅ Joined transaction room: trx-${paymentRef}`);
            });
        }
    }, [organizationId, paymentRef]);

    const onDisconnect = useCallback((reason: string) => {
        console.log("WebSocket disconnected. Reason:", reason);
    }, []);

    const onError = useCallback((error: Error) => {
        console.error("WebSocket error:", error);
    }, []);

    const handleUpdate = useCallback((data: any) => {
        console.log("🔔 Transaction update:", data);

        // Only act on terminal statuses from the webhook
        if (data.event !== 'payment:processed') {
            console.log("Ignoring non-processed event:", data.event);
            return;
        }

        if (data.status === "successful") {
            setPaymentStatus("success");
            setPaymentResult({
                success: true,
                message: "Payment successful!",
                transactionId: data.payment?.reference,
            });
            setShowPaymentResult(true);
            refreshSubscription();
        } else if (data.status === "failed" || data.status === "cancelled") {
            setPaymentStatus("error");
            setPaymentResult({
                success: false,
                message: `Payment ${data.status}. Please try again.`,
                transactionId: data.payment?.reference || "",
            });
            setShowPaymentResult(true);
        }
    }, [refreshSubscription]);


    // -----------------------------------------------------
    // 🟣 WebSocket Setup
    // -----------------------------------------------------
    useEffect(() => {
        if (!organizationId) return;

        const WS_URL = import.meta.env.VITE_WS_URL;
        if (!WS_URL) return;

        const socket = io(WS_URL, {
            withCredentials: true,
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            query: {
                organizationId,
                clientType: "web",
            },
        });

        socketRef.current = socket;

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("error", onError);
        socket.on("connect_error", onError);
        socket.on("transactionUpdate", handleUpdate);

        // Initial connection check
        if (socket.connected) {
            onConnect();
        }

        // Cleanup
        return () => {
            console.log("Cleaning up WebSocket connection...");
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("error", onError);
            socket.off("connect_error", onError);
            socket.off("transactionUpdate", handleUpdate);
            socket.disconnect();
        };
    }, [organizationId, paymentRef, refreshSubscription]);

    // -----------------------------------------------------
    // Select Plan
    // -----------------------------------------------------
    const handleSelectPlan = (plan: any) => {
        const token = localStorage.getItem("token");
        if (!token) {
            navigate("/login");
            return;
        }
        setSelectedPlan(plan);
        setShowPaymentModal(true);
    };

    // Auto-open the payment modal for a renewal triggered from SubscriptionManagementPage.
    useEffect(() => {
        if (!preselectedPlanId || isLoading || !plans.length) return;
        const plan = plans.find((p: any) => String(p.id) === String(preselectedPlanId));
        if (plan) {
            handleSelectPlan(plan);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preselectedPlanId, isLoading, plans]);

    // -----------------------------------------------------
    // 🟣 Initiate Payment (Mobile & Card)
    // -----------------------------------------------------
    const handlePaymentInitiated = async (
        paymentMethod: string,
        phoneNumber?: string,
        duration?: DurationValue
    ) => {
        if (!selectedPlan || !organizationId) {
            toast.error("Please select a plan first.");
            return;
        }

        setIsProcessing(true);
        setPaymentStatus("processing");

        try {
            // -------------------------------------------------
            // 💳 CARD PAYMENT (handled entirely inside PesapalPaymentForm)
            // -------------------------------------------------
            if (paymentMethod === "CARD") {
                return;
            }

            // -------------------------------------------------
            // 📱 MOBILE MONEY PAYMENT
            // -------------------------------------------------
            if (!phoneNumber) {
                throw new Error("Phone number required");
            }

            const res = await subscriptionService.initiateMobilePayment({
                organizationId,
                planId: selectedPlan.id,
                phoneNumber,
                provider: paymentMethod as "MTN" | "AIRTEL",
                months: duration?.months ?? 1,
                billingMode: duration?.billingMode ?? 'MONTHLY',
            });

            // If Paypack returns checkoutUrl → redirect user
            if (res.data.checkoutUrl) {
                window.location.href = res.data.checkoutUrl;
            }

            // If Paypack returns ref → join websocket room
            if (res.data.ref) {
                const ref = res.data.ref;
                setPaymentRef(ref);

                // MOST IMPORTANT — join trx-ref room
                socketRef.current?.emit("joinTransaction", {
                    ref: ref, // Remove the trx- prefix as it's added by the server
                });


                console.log("➡️ Joined trx room:", `trx-${ref}`);
            }
        } catch (error: any) {
            console.error("Payment error:", error);

            const message =
                error.response?.data?.message ||
                error.message ||
                "Payment failed. Please try again.";

            toast.error(message);
            setPaymentStatus("error");
        }

        setIsProcessing(false);
    };

    // -----------------------------------------------------
    // Close Modals
    // -----------------------------------------------------
    const handleModalClose = () => {
        setShowPaymentModal(false);
        setShowPaymentResult(false);
        setPaymentStatus("idle");
        setPaymentRef(null);
        setSelectedPlan(null);
    };

    // -----------------------------------------------------
    // Skeleton (Loading State)
    // -----------------------------------------------------
    if (isLoading) {
        const skeletonPlans = Array.from({ length: 4 });

        return (
            <section className={showPlanHeader ? "bg-[#f2f4f7] py-10 dark:bg-zinc-950 sm:py-14" : "py-4"}>
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    {showPlanHeader && (
                    <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-14">
                        <div className="mx-auto mb-4 h-8 w-3/4 max-w-md animate-pulse rounded-lg bg-gray-200 dark:bg-zinc-800" />
                        <div className="mx-auto mb-3 h-4 w-2/3 max-w-sm animate-pulse rounded bg-gray-200 dark:bg-zinc-800" />
                        <div className="mx-auto flex flex-wrap justify-center gap-2">
                            {[1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="h-9 w-28 animate-pulse rounded-full bg-white dark:bg-zinc-900"
                                />
                            ))}
                        </div>
                    </div>
                    )}

                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        {skeletonPlans.map((_, index) => (
                            <div
                                key={index}
                                className="bg-white rounded-lg shadow-sm border p-6 space-y-4 animate-pulse"
                            >
                                <div className="h-6 w-3/4 bg-gray-200 rounded"></div>
                                <div className="h-8 w-1/2 bg-gray-200 rounded"></div>
                                <div className="h-4 bg-gray-100 rounded"></div>
                                <div className="h-4 bg-gray-100 rounded w-5/6"></div>
                                <div className="h-10 bg-gray-200 rounded mt-4"></div>
                            </div>
                        ))}
                    </div>

                    {showPlanHeader && (
                    <div className="mt-10 text-center">
                        <div className="mx-auto h-4 w-2/3 max-w-md animate-pulse rounded bg-gray-200 dark:bg-zinc-800" />
                    </div>
                    )}
                </div>
            </section>
        );
    }

    // -----------------------------------------------------
    // Render Actual UI
    // -----------------------------------------------------
    return (
        <div className={showPlanHeader ? "bg-[#f2f4f7] dark:bg-zinc-950" : ""}>
            <section className={showPlanHeader ? "py-10 sm:py-14" : "py-0"}>
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    {showPlanHeader && (
                    <div className="mx-auto max-w-3xl text-center">
                        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                            {t("subscription.choosePlan")}
                        </h2>
                        <p className="mt-3 text-base text-gray-600 dark:text-zinc-400 sm:text-lg">
                            {t("subscription.planDesc")}
                        </p>
                        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                            {[
                                t("subscription.trustSecure"),
                                t("subscription.trustSupport"),
                                t("subscription.trustActivate"),
                            ].map((label) => (
                                <span
                                    key={label}
                                    className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                    )}

                    <div
                        className={
                            showPlanHeader
                                ? "mx-auto mt-12 grid max-w-7xl grid-cols-1 gap-6 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4 lg:gap-8"
                                : "mx-auto grid max-w-7xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8"
                        }
                    >
                        {plans.map((plan: any, index: number) => (
                            <PricingCard
                                key={plan.id}
                                title={plan.name}
                                price={plan.price.toLocaleString()}
                                period={plan.billingCycle}
                                features={plan.features.map((f: any) => f.name)}
                                popular={index === 1}
                                onSelect={() => handleSelectPlan(plan)}
                                isProcessing={
                                    isProcessing && selectedPlan?.id === plan.id
                                }
                            />
                        ))}
                    </div>

                    {showPlanHeader && (
                    <p className="mt-12 text-center text-sm text-gray-500 dark:text-zinc-500">
                        {t("subscription.plansFootnote")}
                    </p>
                    )}
                </div>
            </section>

            {/* Payment Method Modal */}
            {selectedPlan && (
                <PaymentMethodModal
                    isOpen={showPaymentModal}
                    onClose={handleModalClose}
                    planName={selectedPlan.name}
                    planId={selectedPlan.id}
                    price={selectedPlan.price}
                    onPaymentInitiated={handlePaymentInitiated}
                    isProcessing={isProcessing}
                    paymentStatus={paymentStatus}
                    currentExpiryDate={renewalCurrentExpiryDate ? new Date(renewalCurrentExpiryDate) : null}
                />
            )}

            {/* Payment Result Modal */}
            <Drawer open={showPaymentResult && !!paymentResult} onOpenChange={setShowPaymentResult}>
                <DrawerContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <DrawerHeader className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
                        <DrawerTitle className="text-center">
                            {paymentResult?.success
                                ? "Payment Successful"
                                : "Payment Failed"}
                        </DrawerTitle>
                    </DrawerHeader>
                    {paymentResult && (
                        <div className="px-6 pb-6">
                            <div className="text-center">
                                <div
                                    className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${paymentResult.success
                                        ? "bg-green-100"
                                        : "bg-red-100"
                                        }`}
                                >
                                    {paymentResult.success ? (
                                        <svg
                                            className="h-6 w-6 text-green-600"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M5 13l4 4L19 7"
                                            />
                                        </svg>
                                    ) : (
                                        <svg
                                            className="h-6 w-6 text-red-600"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M6 18L18 6M6 6l12 12"
                                            />
                                        </svg>
                                    )}
                                </div>

                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                                    {paymentResult.message}
                                </p>

                                {paymentResult.transactionId && (
                                    <p className="text-xs text-gray-400 mt-2">
                                        Transaction ID: {paymentResult.transactionId}
                                    </p>
                                )}

                                <div className="mt-6 flex flex-col sm:flex-row sm:justify-center sm:space-x-3 space-y-2 sm:space-y-0">
                                    {paymentResult.success ? (
                                        <button
                                            onClick={() => {
                                                handleModalClose();
                                                navigate("/dashboard");
                                            }}
                                            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                                        >
                                            Go to Dashboard
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => {
                                                    handleModalClose();
                                                    navigate("/");
                                                }}
                                                className="w-full sm:w-auto px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                                            >
                                                Go Home
                                            </button>

                                            <button
                                                onClick={() => {
                                                    setShowPaymentResult(false);
                                                    setPaymentStatus("idle");
                                                    setPaymentResult({
                                                        success: false,
                                                        message: "Payment failed",
                                                        transactionId: "",
                                                    });
                                                    if (selectedPlan)
                                                        setShowPaymentModal(true);
                                                }}
                                                className="w-full sm:w-auto px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                                            >
                                                Retry
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </DrawerContent>
            </Drawer>
        </div>
    );
};

export default SubscriptionPage;
