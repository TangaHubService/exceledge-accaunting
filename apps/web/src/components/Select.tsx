import { Check, ChevronDown, Search } from "lucide-react";
import { type CSSProperties, Fragment, type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  /** Shown before the label in a muted monospace, e.g. an account code. */
  prefix?: string;
  /** Secondary text shown on the right, e.g. an outstanding amount. */
  hint?: string;
  group?: string;
};

const PANEL_MAX_HEIGHT = 320;

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable,
  invalid,
  disabled,
  required,
  emptyText = "Nothing to choose from",
  className,
  style,
  "aria-label": ariaLabel,
}: {
  /** Shown when there are no options at all. */
  emptyText?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Defaults to on for lists longer than eight options. */
  searchable?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});

  const withSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.prefix ?? ""} ${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom;
    const up = below < Math.min(PANEL_MAX_HEIGHT, 240) && rect.top > below;
    setPosition(up ? { left, width, bottom: window.innerHeight - rect.top + 4 } : { left, width, top: rect.bottom + 4 });
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  function openPanel() {
    if (disabled) return;
    place();
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(option: SelectOption) {
    onChange(option.value);
    close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    if (withSearch) panel.current?.querySelector("input")?.focus();
    else list.current?.focus();
  }, [open, withSearch]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    }
    function onMove(e: Event) {
      if (panel.current?.contains(e.target as Node)) return;
      place();
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place, close]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openPanel();
    }
  }

  function onPanelKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : visible.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[active]) choose(visible[active]);
    }
  }

  return (
    <span className={`select ${className ?? ""}`} style={style}>
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        className={`input select-trigger ${invalid ? "invalid" : ""} ${open ? "open" : ""}`}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKey}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
      >
        <span className={`select-value ${selected ? "" : "placeholder"}`}>
          {selected?.prefix && <span className="select-prefix">{selected.prefix}</span>}
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="select-chevron" />
      </button>
      {required && (
        <input
          className="select-proxy"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          onChange={() => undefined}
          required
          onInvalid={() => trigger.current?.focus()}
        />
      )}
      {open &&
        createPortal(
          <div ref={panel} className="select-panel" style={position} onKeyDown={onPanelKey}>
            {withSearch && (
              <div className="select-search">
                <Search size={15} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search…"
                  aria-label="Search options"
                  aria-controls={`${id}-list`}
                  aria-activedescendant={visible[active] ? `${id}-${active}` : undefined}
                />
              </div>
            )}
            <div
              ref={list}
              id={`${id}-list`}
              className="select-list"
              role="listbox"
              tabIndex={-1}
              aria-labelledby={`${id}-trigger`}
              aria-activedescendant={!withSearch && visible[active] ? `${id}-${active}` : undefined}
            >
              {visible.length === 0 && <div className="select-empty">{query.trim() ? "No matches" : emptyText}</div>}
              {visible.map((o, i) => (
                <Fragment key={o.value || "__none"}>
                  {o.group && o.group !== visible[i - 1]?.group && (
                    <div className="select-group" role="presentation">
                      {o.group}
                    </div>
                  )}
                  <div
                    id={`${id}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={o.value === value}
                    className={`select-option ${i === active ? "active" : ""} ${o.value === value ? "selected" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                  >
                    {o.prefix && <span className="select-prefix">{o.prefix}</span>}
                    <span className="select-label">{o.label}</span>
                    {o.hint && <span className="select-hint">{o.hint}</span>}
                    <Check size={15} aria-hidden="true" className="select-check" />
                  </div>
                </Fragment>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
