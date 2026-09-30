import type { CSSProperties, ReactNode } from "react";

/**
 * Global skeleton loading system.
 *
 * One base bar plus layout-matched compositions that reuse the app's real
 * layout classes (.figures, .table, .panel, .form-grid …) so loading state
 * occupies exactly the space the content will — no layout shift.
 *
 * Bars are decorative; containers carry `aria-busy` + an accessible label.
 * Widths follow a deterministic pattern (no randomness).
 */

const WIDTHS = [62, 44, 78, 55, 68, 38];

function widthAt(i: number, scale = 1) {
  return `${Math.round(WIDTHS[i % WIDTHS.length] * scale)}%`;
}

export function Skeleton({
  width,
  height = 12,
  radius = 4,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className ?? ""}`}
      style={{
        width: typeof width === "number" ? `${width}px` : (width ?? "100%"),
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: typeof radius === "number" ? `${radius}px` : radius,
        ...style,
      }}
    />
  );
}

function Busy({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** Skeleton for `.table` content. Keeps header/footer layout; pagination-safe. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  showHeader = false,
  showActions = false,
  showCheckboxes = false,
  label = "Loading table",
  wrap = true,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  showActions?: boolean;
  showCheckboxes?: boolean;
  label?: string;
  /** Set false when the caller already provides the `.table-wrap`. */
  wrap?: boolean;
}) {
  const cols = columns + (showActions ? 1 : 0);
  const table = (
        <table className="table" aria-hidden="true">
          {showHeader && (
            <thead>
              <tr>
                {showCheckboxes && (
                  <th style={{ width: 36 }}>
                    <Skeleton width={14} height={14} radius={3} />
                  </th>
                )}
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c}>
                    <Skeleton width={c === 0 ? "45%" : "70%"} height={10} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {showCheckboxes && (
                  <td style={{ width: 36 }}>
                    <Skeleton width={14} height={14} radius={3} />
                  </td>
                )}
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className={c === cols - 1 && showActions ? "num" : undefined}>
                    <Skeleton
                      width={c === 0 ? "60%" : widthAt(r + c)}
                      style={c === cols - 1 && showActions ? { marginLeft: "auto", width: 24 } : undefined}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
  );
  if (!wrap) return <Busy label={label}>{table}</Busy>;
  return (
    <div className="table-wrap">
      <Busy label={label}>{table}</Busy>
    </div>
  );
}

/** Skeleton for the `.figures` KPI strip. `count` should match the figures that will render. */
export function FiguresSkeleton({ count = 4, lead = true }: { count?: number; lead?: boolean }) {
  return (
    <Busy label="Loading summary">
      <section
        className="figures"
        aria-hidden="true"
        style={{ "--cols": count } as CSSProperties}
      >
        {Array.from({ length: count }, (_, i) => (
          <div className={`figure ${lead && i === 0 ? "lead" : ""}`} key={i}>
            <Skeleton width="45%" height={11} />
            <div style={{ marginTop: 8 }}>
              <Skeleton width="70%" height={lead && i === 0 ? 26 : 22} radius={4} />
            </div>
            <div style={{ marginTop: 6 }}>
              <Skeleton width="55%" height={11} />
            </div>
          </div>
        ))}
      </section>
    </Busy>
  );
}

/** Alias for the KPI strip skeleton, for call sites that think in stat cards. */
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return <FiguresSkeleton count={count} />;
}

/** Skeleton for a generic `.panel` card with an optional title row. */
export function CardSkeleton({
  title = true,
  lines = 3,
  actions = false,
  label = "Loading",
}: {
  title?: boolean;
  lines?: number;
  actions?: boolean;
  label?: string;
}) {
  return (
    <div className="panel">
      <Busy label={label}>
        <div className="panel-body" aria-hidden="true">
          {title && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Skeleton width={140} height={14} />
              {actions && <Skeleton width={72} height={28} radius={6} />}
            </div>
          )}
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} style={{ marginTop: i === 0 && !title ? 0 : 10 }}>
              <Skeleton width={widthAt(i, 1.4)} />
            </div>
          ))}
        </div>
      </Busy>
    </div>
  );
}

/** Skeleton for stacked rows (attention lists, activity, recent transactions). */
export function ListSkeleton({ rows = 4, label = "Loading list" }: { rows?: number; label?: string }) {
  return (
    <Busy label={label}>
      <ul className="sk-list" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <Skeleton width={7} height={7} radius="50%" />
            <span className="sk-list-main">
              <Skeleton width={widthAt(i, 1.1)} height={13} />
              <span style={{ display: "block", marginTop: 5 }}>
                <Skeleton width={widthAt(i + 2, 0.8)} height={11} />
              </span>
            </span>
            <Skeleton width={64} height={13} />
          </li>
        ))}
      </ul>
    </Busy>
  );
}

/** Skeleton for the ageing `.bars` panels. */
export function BarsSkeleton({ rows = 5, label = "Loading chart" }: { rows?: number; label?: string }) {
  return (
    <Busy label={label}>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div className="bar-row" key={i}>
            <Skeleton width="80%" height={11} />
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${[72, 48, 30, 18, 10][i % 5]}%`, opacity: 0.45 }} />
            </div>
            <Skeleton width="85%" height={11} />
          </div>
        ))}
        <div className="bar-total">
          <Skeleton width={90} height={12} />
          <Skeleton width={110} height={12} />
        </div>
      </div>
    </Busy>
  );
}

/** Skeleton for forms: labels plus input-height boxes in the real `.form-grid`. */
export function FormSkeleton({
  fields = 6,
  columns = 2,
  submit = true,
  label = "Loading form",
}: {
  fields?: number;
  columns?: 1 | 2;
  submit?: boolean;
  label?: string;
}) {
  return (
    <Busy label={label}>
      <div
        className="form-grid"
        aria-hidden="true"
        style={columns === 1 ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}
      >
        {Array.from({ length: fields }, (_, i) => (
          <div className="field" key={i}>
            <Skeleton width={96} height={11} />
            <Skeleton height={34} radius={6} />
          </div>
        ))}
      </div>
      {submit && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }} aria-hidden="true">
          <Skeleton width={84} height={34} radius={6} />
          <Skeleton width={120} height={34} radius={6} />
        </div>
      )}
    </Busy>
  );
}

/** Full page loading: title + description + action placeholders, then content. */
export function PageSkeleton({
  description = true,
  actions = 1,
  children,
  label = "Loading page",
}: {
  description?: boolean;
  actions?: number;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <Busy label={label}>
      <div aria-hidden="true">
        <header className="page-header">
          <div>
            <Skeleton width={240} height={24} radius={4} />
            {description && (
              <div style={{ marginTop: 6 }}>
                <Skeleton width={320} height={12} />
              </div>
            )}
          </div>
          {actions > 0 && (
            <div className="actions">
              {Array.from({ length: actions }, (_, i) => (
                <Skeleton key={i} width={110} height={34} radius={6} />
              ))}
            </div>
          )}
        </header>
        {children ?? <TableSkeleton rows={8} columns={4} showHeader />}
      </div>
    </Busy>
  );
}

/** Placeholder results for the header command palette while searching. */
export function SearchResultsSkeleton({ groups = 2, rowsPerGroup = 3 }: { groups?: number; rowsPerGroup?: number }) {
  return (
    <div aria-busy="true" aria-label="Searching" aria-hidden="true">
      {Array.from({ length: groups }, (_, g) => (
        <div className="sk-search-group" key={g}>
          <Skeleton width={88} height={10} />
          {Array.from({ length: rowsPerGroup }, (_, i) => (
            <div className="sk-search-item" key={i}>
              <Skeleton width={26} height={26} radius={6} />
              <span className="sk-search-main">
                <Skeleton width={widthAt(g * 3 + i, 1.5)} height={13} />
                <span style={{ display: "block", marginTop: 5 }}>
                  <Skeleton width={widthAt(g * 3 + i + 1, 1.0)} height={11} />
                </span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
