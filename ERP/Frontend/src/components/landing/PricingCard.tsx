import { Check, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTranslation } from "react-i18next";

interface PricingCardProps {
  title: string;
  price: string;
  period?: string;
  features: string[];
  popular?: boolean;
  onSelect?: () => void;
  className?: string;
  isProcessing?: boolean;
}

export const PricingCard = ({
  title,
  price,
  period,
  features,
  popular = false,
  onSelect,
  className,
  isProcessing,
}: PricingCardProps) => {
  const { t } = useTranslation();

  const CORE_FEATURE_COUNT = 5;
  const coreFeatures = features.slice(0, CORE_FEATURE_COUNT);
  const extraFeatures = features.slice(CORE_FEATURE_COUNT);

  const periodDisplay = period
    ? period.toLowerCase().includes("month")
      ? t("subscription.perMonth")
      : period.toLowerCase().includes("year")
        ? t("subscription.perYear")
        : `/${period}`
    : null;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm transition-shadow duration-200 dark:border-zinc-700 dark:bg-zinc-900",
        popular
          ? "z-[1] border-blue-600 shadow-lg ring-2 ring-blue-600 dark:border-blue-500 dark:ring-blue-500"
          : "border-gray-200 hover:shadow-md dark:hover:border-zinc-600",
        className
      )}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-blue-600 px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow-md dark:bg-blue-500">
          {t("subscription.mostPopular")}
        </div>
      )}

      <div className={cn("pt-2", popular && "pt-4")}>
        <h3 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-1 min-h-[2.5rem] text-sm leading-snug text-gray-500 dark:text-zinc-400">
          {popular
            ? t("subscription.planTaglinePopular")
            : t("subscription.planTaglineDefault")}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-x-1 gap-y-0 pb-6">
        <span className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
          {price}
        </span>
        <span className="pb-1 text-lg font-semibold text-gray-700 dark:text-zinc-300">
          {t("subscription.currencyRwf")}
        </span>
        {periodDisplay && (
          <span className="w-full pb-0.5 text-sm font-medium text-gray-500 dark:text-zinc-400">
            {periodDisplay}
          </span>
        )}
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {coreFeatures.map((feature, index) => (
          <li key={index} className="flex gap-3 text-sm text-gray-600 dark:text-zinc-300">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Check className="h-3 w-3 stroke-[3]" aria-hidden />
            </span>
            <span className="leading-snug">{feature}</span>
          </li>
        ))}
        {extraFeatures.map((feature, index) => (
          <li key={index} className="flex gap-3 text-sm text-gray-600 dark:text-zinc-300">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Check className="h-3 w-3 stroke-[3]" aria-hidden />
            </span>
            <span className="leading-snug">{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <button
          type="button"
          onClick={onSelect}
          disabled={isProcessing}
          className={cn(
            "flex w-full items-center justify-center rounded-lg py-3.5 text-base font-semibold text-white transition-colors",
            "bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-600 dark:hover:bg-blue-500"
          )}
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              {t("subscription.planProcessing")}
            </span>
          ) : (
            t("subscription.choosePlanButton")
          )}
        </button>
      </div>
    </div>
  );
};
