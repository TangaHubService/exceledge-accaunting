import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Image
} from '@react-pdf/renderer';
import { format } from 'date-fns';
import logo from "../../assets/vdlogo.fd0748ee6ccf6d81d171.png";
import type { Profile } from '../../types';

// Sales Invoice Types
export interface SaleItem {
    id: string;
    product: {
        name: string;
        batchNumber?: string;
    };
    quantity: number;
    unitPrice: string;
    totalPrice: string;
}

export interface Sale {
    id: string;
    saleNumber: string;
    customer: {
        name: string;
        email?: string;
        phone?: string;
    };
    user: {
        name: string;
    };
    paymentType: string;
    cashAmount: string;
    insuranceAmount: string;
    debtAmount: string;
    totalAmount: string;
    createdAt: string;
    status: string;
    saleItems: SaleItem[];
}

export interface BillingPayment {
    id: string;
    amount: number;
    currency: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'COMPLETED' | 'PAID';
    paymentMethod: string;
    createdAt: string;
    metadata?: {
        provider?: string;
        fee?: number;
        client?: string;
        phone?: string;
        merchant?: string;
        paymentId?: string;
        processedAt?: string;
        payment_method?: string;
        [key: string]: unknown;
    } | null;
    subscription: {
        plan: {
            name: string;
            price?: number;
            currency?: string;
        };
        startDate?: string;
        endDate?: string;
        autoRenew?: boolean;
        organization?: {
            id?: string | number;
            name?: string;
            TIN?: string | null;
            address?: string | null;
        };
        [key: string]: unknown;
    };
    // RRA EBM / VSDC fiscalization fields (persisted on the Payment row).
    invoiceNumber?: string | null;
    ebmInvoiceNumber?: string | null;
    submissionStatus?: string | null;
    submittedAt?: string | null;
    sdcDateTime?: string | null;
    sdcId?: string | null;
    sdcRcptNo?: number | null;
    totalRcptNo?: number | null;
    internalData?: string | null;
    receiptSignature?: string | null;
    qrPayload?: string | null;
    rcptLabel?: string | null;
    errorMessage?: string | null;
}

// ⭐ Improved Styling
const styles = StyleSheet.create({
    page: {
        padding: 40,
        fontSize: 11,
        fontFamily: 'Helvetica',
        position: "relative"
    },
    watermark: {
        position: "absolute",
        top: "25%",
        left: "15%",
        width: "100%",
        opacity: 0.08,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 30,
        borderBottom: "1 solid #ddd",
        paddingBottom: 15,
    },
    leftHeader: {
        flexDirection: "column",
        gap: 4,
    },
    invoiceTitle: {
        fontSize: 26,
        fontWeight: "bold",
        letterSpacing: 1,
        color: "#333",
        marginBottom: 5,
    },
    companyInfo: {
        textAlign: "right",
        lineHeight: 1,
    },
    logo: {
        width: 55,
        height: 55,
        marginBottom: 5,
        alignSelf: "flex-start",
    },
    section: {
        marginBottom: 25,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "bold",
        marginBottom: 10,
        borderBottom: "1 solid #e6e6e6",
        paddingBottom: 4,
        color: "#333",
    },
    row: {
        flexDirection: "row",
        marginBottom: 6,
    },
    label: {
        fontWeight: "bold",
        width: 130,
        color: "#444",
    },
    value: {
        color: "#333",
    },
    statusBox: {
        padding: "3px 8px",
        borderRadius: 5,
        fontSize: 9,
        fontWeight: "bold",
        textTransform: "uppercase",
    },
    totalSection: {
        marginTop: 20,
        paddingTop: 10,
        borderTop: "1 solid #ccc",
        flexDirection: "row",
        justifyContent: "flex-end",
    },
    footer: {
        position: "absolute",
        bottom: 25,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 9,
        color: "#777",
    },
    fiscalBox: {
        marginTop: 25,
        border: "1 solid #cbd5e1",
        borderRadius: 5,
        padding: 12,
        backgroundColor: "#f8fafc",
    },
    fiscalTitle: {
        fontSize: 11,
        fontWeight: "bold",
        color: "#1e3a8a",
        marginBottom: 6,
        textAlign: "center",
    },
    fiscalMuted: {
        fontSize: 8,
        color: "#64748b",
        textAlign: "center",
        marginTop: 4,
    },
});

interface InvoicePDFProps {
    payment: BillingPayment;
    profile: Profile | null;
}

function dashEvery4(str: string): string {
    return str.replace(/(.{4})/g, "$1 ").trim();
}

const RCPT_LABEL_DISPLAY: Record<string, string> = {
    NS: 'Normal Sale',
    NR: 'Normal Refund',
    CS: 'Copy Sale',
    CR: 'Copy Refund',
    TS: 'Training Sale',
    TR: 'Training Refund',
    PS: 'Proforma Sale',
};

interface FiscalBlock {
    success: boolean;
    pending: boolean;
    failed: boolean;
    ebmInvoiceNumber: string | null;
    sdcRcptNo: number | null;
    totalRcptNo: number | null;
    sdcId: string | null;
    internalData: string | null;
    receiptSignature: string | null;
    sdcDateTime: string | null;
    rcptLabel: string | null;
    errorMessage: string | null;
}

function fiscalBlockFromPayment(payment: BillingPayment): FiscalBlock {
    const status = payment.submissionStatus ?? null;
    return {
        success: status === 'SUCCESS',
        pending: !!status && ['PENDING', 'SUBMITTED', 'RETRYING'].includes(status),
        failed: status === 'FAILED',
        ebmInvoiceNumber: payment.ebmInvoiceNumber ?? null,
        sdcRcptNo: payment.sdcRcptNo ?? null,
        totalRcptNo: payment.totalRcptNo ?? null,
        sdcId: payment.sdcId ?? null,
        internalData: payment.internalData ?? null,
        receiptSignature: payment.receiptSignature ?? null,
        sdcDateTime: payment.sdcDateTime ?? null,
        rcptLabel: payment.rcptLabel ?? null,
        errorMessage: payment.errorMessage ?? null,
    };
}

const InvoicePDF: React.FC<InvoicePDFProps> = ({ payment, profile }) => {
    const statusColor =
        payment.status === 'PAID' ||
            payment.status === 'COMPLETED' ||
            payment.status === 'SUCCEEDED'
            ? '#10B981'
            : payment.status === 'FAILED'
                ? '#EF4444'
                : '#F59E0B';

    return (
        <Document>
            <Page size="A4" style={styles.page}>

                {/* HEADER */}
                <View style={styles.header}>
                    {/* Left */}
                    <View style={styles.leftHeader}>
                        <Text style={styles.invoiceTitle}>INVOICE</Text>

                        <View style={styles.row}>
                            <Text style={styles.label}>Invoice ID:</Text>
                            <Text style={styles.value}>
                                {String(payment.id).split("-")[0].toUpperCase()}
                            </Text>
                        </View>

                        <View style={styles.row}>
                            <Text style={styles.label}>Invoice Date:</Text>
                            <Text style={styles.value}>
                                {format(new Date(payment.createdAt), "PPP")}
                            </Text>
                        </View>
                    </View>

                    {/* Right */}
                    <View style={styles.companyInfo}>
                        <Image src={logo} style={styles.logo} />

                        <Text style={{ fontSize: 14, fontWeight: "bold" }}>
                            Exceledge ERP
                        </Text>
                        <Text>42 St KK 718, Excelege</Text>
                        <Text>Kigali, Rwanda</Text>
                        <Text>+250 788 701 837</Text>
                        <Text>info@exceledgecpa.com</Text>
                    </View>
                </View>

                {/* CUSTOMER INFO */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>CUSTOMER INFORMATION</Text>
                    <View style={styles.row}>
                        <Text style={styles.label}>Name</Text>
                        <Text style={styles.value}>
                            {profile?.name || "N/A"}
                        </Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Phone Number:</Text>
                        <Text style={styles.value}>{profile?.phone || "N/A"}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Email:</Text>
                        <Text style={styles.value}>{profile?.email || "N/A"}</Text>
                    </View>


                </View>

                {/* SUBSCRIPTION DETAILS */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>SUBSCRIPTION DETAILS</Text>

                    <View style={styles.row}>
                        <Text style={styles.label}>Plan:</Text>
                        <Text style={styles.value}>
                            {payment.subscription?.plan?.name || "N/A"}
                        </Text>
                    </View>

                    <View style={styles.row}>
                        <Text style={styles.label}>Amount:</Text>
                        <Text style={styles.value}>
                            {payment.currency} {payment.amount.toLocaleString()}
                        </Text>
                    </View>

                    <View style={styles.row}>
                        <Text style={styles.label}>Auto Renew:</Text>
                        <Text style={styles.value}>
                            {payment.subscription?.autoRenew ? "Yes" : "No"}
                        </Text>
                    </View>

                    <View style={styles.row}>
                        <Text style={styles.label}>Subscription Period:</Text>
                        <Text style={styles.value}>
                            {payment.subscription?.startDate
                                ? format(new Date(payment.subscription.startDate), "PPP")
                                : "N/A"}{" "}
                            {payment.subscription?.endDate
                                ? `→ ${format(
                                    new Date(payment.subscription.endDate),
                                    "PPP"
                                )}`
                                : ""}
                        </Text>
                    </View>
                </View>

                {/* PAYMENT INFO */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PAYMENT INFORMATION</Text>

                    <View style={styles.row}>
                        <Text style={styles.label}>Payment Method:</Text>
                        <Text style={styles.value}>
                            {
                                String(payment.metadata?.payment_method ?? '')
                                    .toUpperCase() || payment.paymentMethod || 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.row}>
                        <Text style={styles.label}>Reference:</Text>
                        <Text style={styles.value}>
                            {payment.metadata?.paymentId || payment.id}
                        </Text>
                    </View>

                    <View style={styles.row}>
                        <Text style={styles.label}>Status:</Text>
                        <Text
                            style={{
                                ...styles.statusBox,
                                backgroundColor: `${statusColor}22`,
                                color: statusColor,
                            }}
                        >
                            {payment.status}
                        </Text>
                    </View>
                </View>

                {/* TOTAL */}
                <View style={styles.totalSection}>
                    <Text style={{ fontWeight: "bold", marginRight: 10 }}>
                        TOTAL:
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: "bold" }}>
                        {payment.currency} {payment.amount.toLocaleString()}
                    </Text>
                </View>

                {/* RRA EBM / VSDC fiscal data (when present) */}
                {(() => {
                    const f = fiscalBlockFromPayment(payment);
                    if (!f.success && !f.pending && !f.failed) {
                        return null;
                    }
                    const counter = f.sdcRcptNo != null && f.totalRcptNo != null
                        ? `${f.sdcRcptNo}/${f.totalRcptNo}${f.rcptLabel ? ` ${f.rcptLabel}` : ''}`
                        : null;
                    const tin = payment.subscription?.organization?.TIN ?? null;

                    return (
                        <View style={styles.fiscalBox}>
                            <Text style={styles.fiscalTitle}>
                                RWANDA REVENUE AUTHORITY
                            </Text>
                            <Text style={styles.fiscalTitle}>RRA EBM FISCAL RECEIPT</Text>

                            {!f.success ? (
                                <View style={{
                                    backgroundColor: f.failed ? '#fee2e2' : '#fef3c7',
                                    borderRadius: 3,
                                    padding: 5,
                                    marginBottom: 6,
                                }}>
                                    <Text style={{ fontSize: 9, fontWeight: 'bold', color: f.failed ? '#991b1b' : '#92400e' }}>
                                        NOT YET FISCALIZED
                                    </Text>
                                    <Text style={{ fontSize: 8, color: f.failed ? '#991b1b' : '#92400e', marginTop: 2 }}>
                                        {f.failed
                                            ? `Last fiscal error: ${f.errorMessage ?? 'Unknown'}`
                                            : 'Fiscal submission pending or retrying — this receipt has not yet been confirmed by RRA.'}
                                    </Text>
                                </View>
                            ) : null}

                            {f.rcptLabel ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>Receipt Type:</Text>
                                    <Text style={styles.value}>
                                        {f.rcptLabel} — {RCPT_LABEL_DISPLAY[f.rcptLabel] ?? f.rcptLabel}
                                    </Text>
                                </View>
                            ) : null}

                            {tin ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>Seller TIN:</Text>
                                    <Text style={styles.value}>{tin}</Text>
                                </View>
                            ) : null}

                            {payment.invoiceNumber ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>Invoice #:</Text>
                                    <Text style={styles.value}>{payment.invoiceNumber}</Text>
                                </View>
                            ) : null}

                            {f.ebmInvoiceNumber ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>EBM Invoice #:</Text>
                                    <Text style={styles.value}>{f.ebmInvoiceNumber}</Text>
                                </View>
                            ) : null}

                            {counter ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>Receipt Counter:</Text>
                                    <Text style={styles.value}>{counter}</Text>
                                </View>
                            ) : null}

                            {f.sdcId ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>SDC Device ID:</Text>
                                    <Text style={styles.value}>{f.sdcId}</Text>
                                </View>
                            ) : null}

                            {f.sdcDateTime ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>SDC Date/Time:</Text>
                                    <Text style={styles.value}>{format(new Date(f.sdcDateTime), "PPP pp")}</Text>
                                </View>
                            ) : null}

                            {f.internalData ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>Internal Data:</Text>
                                    <Text style={[styles.value, { fontSize: 7 }]}>{dashEvery4(f.internalData)}</Text>
                                </View>
                            ) : null}

                            {f.receiptSignature ? (
                                <View style={styles.row}>
                                    <Text style={styles.label}>Signature:</Text>
                                    <Text style={[styles.value, { fontSize: 7 }]}>{dashEvery4(f.receiptSignature)}</Text>
                                </View>
                            ) : null}
                        </View>
                    );
                })()}

                {/* FOOTER */}
                <View style={styles.footer}>
                    <Text>Thank you for choosing Exceledge ERP!</Text>
                    <Text>For inquiries: support@exceledgecpa.com</Text>
                </View>
            </Page>
        </Document>
    );
};

export default InvoicePDF;
