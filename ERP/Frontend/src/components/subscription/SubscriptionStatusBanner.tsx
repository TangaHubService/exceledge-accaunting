import { AlertTriangle } from 'lucide-react';

export type SubscriptionWarningLevel = 'none' | 'yellow' | 'orange' | 'red' | 'expired';

interface SubscriptionStatusBannerProps {
    warningLevel?: SubscriptionWarningLevel | string | null;
    warningMessage?: string | null;
    graceDayLabel?: string | null;
}

const LEVEL_STYLES: Record<string, string> = {
    yellow: 'bg-yellow-50 border-yellow-300 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-300',
    orange: 'bg-orange-50 border-orange-300 text-orange-800 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300',
    red: 'bg-red-50 border-red-300 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300',
    expired: 'bg-red-100 border-red-400 text-red-900 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200',
};

/**
 * Renders the yellow/orange/red/expired subscription warning banner (spec
 * section 11). Purely presentational — driven entirely by the
 * warningLevel/warningMessage/graceDayLabel fields OrganizationContext
 * already gets from computeSubscriptionSummary via the org endpoint.
 */
export const SubscriptionStatusBanner = ({
    warningLevel,
    warningMessage,
    graceDayLabel,
}: SubscriptionStatusBannerProps) => {
    if (!warningLevel || warningLevel === 'none' || !warningMessage) {
        return null;
    }

    const styles = LEVEL_STYLES[warningLevel] ?? LEVEL_STYLES.yellow;

    return (
        <div
            className={`flex items-center gap-3 border-b px-4 py-2.5 text-sm font-medium ${styles}`}
            role="alert"
        >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{warningMessage}</span>
            {graceDayLabel && (
                <span className="ml-auto flex-shrink-0 rounded-full bg-white/60 dark:bg-black/20 px-2.5 py-0.5 text-xs font-semibold">
                    {graceDayLabel}
                </span>
            )}
        </div>
    );
};
