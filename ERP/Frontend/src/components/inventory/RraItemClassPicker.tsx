import { SearchableSelect } from "../ui/SearchableSelect";
import { ITEM_CLASSIFICATION_OPTIONS, ITEM_CLASSIFICATION_LABELS } from "../../types/ebm";
import { cn } from "../../lib/utils";

/**
 * Searchable classification picker — text labels only; the RRA code is stored
 * as the option value (not shown in the UI). Uses the shared SearchableSelect
 * pattern instead of a native <select>.
 */
export function RraItemClassPicker({
  value,
  onChange,
  invalid,
  required = false,
}: {
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  required?: boolean;
}) {
  const known = value in ITEM_CLASSIFICATION_LABELS;
  const options = !value || known
    ? ITEM_CLASSIFICATION_OPTIONS
    : [
        { value, label: ITEM_CLASSIFICATION_LABELS[value] ?? "Selected classification" },
        ...ITEM_CLASSIFICATION_OPTIONS,
      ];

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        RRA item classification{required ? <span className="text-red-500"> *</span> : null}
      </label>
      <SearchableSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder={required ? "Select classification…" : "Select classification (optional)"}
        searchPlaceholder="Search classification…"
        emptyText="No matching classification."
        className={cn(
          "h-auto min-h-[42px] rounded-xl border px-3.5 py-2.5",
          invalid ? "border-red-400" : "border-gray-200 dark:border-gray-700",
        )}
      />
      <p className="text-xs text-gray-400">
        {required
          ? "Required by RRA. Pick the closest matching class for this item."
          : "Pick the closest matching RRA class for this item."}
      </p>
    </div>
  );
}

export default RraItemClassPicker;
