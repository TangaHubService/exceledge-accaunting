import { ChartLine, CircleX } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { amount } from "../../lib/format";
import { compactMoney } from "../../lib/reports";

/* Validated with the dataviz palette script: legend and table view relieve the lighter blue. */
export const SERIES = ["#1238e6", "#7fb2f5", "#0a8f7f"] as const;
/** Ordinal ramp for ageing buckets, nearest-due darkest. */
const AGE_RAMP = ["#0d2bb8", "#1238e6", "#3f7fe8", "#7fb2f5", "#b5d2f8", "#d7e6fb"];

const GRID = "#d5e2f6";
const SURFACE = "#ffffff";

export type Series = { name: string; color: string; values: Array<number | null>; dashed?: boolean; plain?: boolean; kind?: "bar" | "line" | "area" };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    obs.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => obs.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(max: number) {
  if (max <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * pow;
}

export function TimeChart({
  labels,
  series,
  height = 190,
  money = true,
  prefix = "",
  ticks = 5,
  compact = false,
  decimals = 2,
  label,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  money?: boolean;
  prefix?: string;
  ticks?: number;
  compact?: boolean;
  decimals?: number;
  /** Plain-language description for screen readers. */
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const rawMax = Math.max(0, ...all);
  const rawMin = Math.min(0, ...all);
  const magnitude = niceMax(Math.max(rawMax, -rawMin));
  const top = rawMin < 0 ? magnitude : niceMax(rawMax);
  const bottom = rawMin < 0 ? -magnitude : 0;
  const span = top - bottom || 1;

  const fmtAxis = (n: number) => `${prefix}${top <= 1 ? n.toFixed(2) : compactMoney(n)}`;
  const fmtFull = (n: number | null) => (n === null ? "—" : money ? `${prefix} ${amount(n, 2)}`.trim() : amount(n, decimals));

  const left = compact ? 44 : Math.max(52, fmtAxis(top).length * 7 + 10);
  const right = 8;
  const topPad = 8;
  const bottomPad = 24;
  const plotW = Math.max(10, width - left - right);
  const plotH = Math.max(10, height - topPad - bottomPad);
  const n = Math.max(1, labels.length);
  const band = plotW / n;
  const x = (i: number) => left + band * i + band / 2;
  const y = (v: number) => topPad + plotH - ((v - bottom) / span) * plotH;
  const zero = y(0);

  const bars = series.filter((s) => (s.kind ?? "bar") === "bar");
  const lines = series.filter((s) => s.kind === "line" || s.kind === "area");
  const barW = bars.length ? Math.min(22, Math.max(3, (band * 0.7 - (bars.length - 1) * 2) / bars.length)) : 0;
  // Keep zero on a gridline when the chart crosses it.
  const tickCount = bottom < 0 ? Math.max(2, Math.round(ticks / 2) * 2) : ticks;
  const tickValues = Array.from({ length: tickCount + 1 }, (_, i) => bottom + (span * i) / tickCount);
  const skip = band < 34 ? Math.ceil(34 / band) : 1;

  const onMove = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - left) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div ref={ref} className="rp-chart" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
        >
          {tickValues.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className="rp-axis">
                {fmtAxis(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % skip === 0 ? (
              <text key={l + i} x={x(i)} y={height - 6} textAnchor="middle" className="rp-axis">
                {l}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={topPad} y2={topPad + plotH} stroke="#8aa4d6" strokeWidth={1} />}
          {bars.map((s, si) =>
            s.values.map((v, i) => {
              if (v === null || v === 0) return null;
              const gx = x(i) - (bars.length * barW + (bars.length - 1) * 2) / 2 + si * (barW + 2);
              const h = Math.max(2, Math.abs(y(v) - zero));
              const r = Math.min(4, barW / 2, h);
              const d =
                v > 0
                  ? `M${gx},${zero}V${zero - h + r}Q${gx},${zero - h} ${gx + r},${zero - h}H${gx + barW - r}Q${gx + barW},${zero - h} ${gx + barW},${zero - h + r}V${zero}Z`
                  : `M${gx},${zero}V${zero + h - r}Q${gx},${zero + h} ${gx + r},${zero + h}H${gx + barW - r}Q${gx + barW},${zero + h} ${gx + barW},${zero + h - r}V${zero}Z`;
              return <path key={`${s.name}${i}`} d={d} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />;
            }),
          )}
          {lines.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)));
            const runs: Array<Array<readonly [number, number]>> = [];
            let run: Array<readonly [number, number]> = [];
            for (const p of pts) {
              if (p) run.push(p);
              else if (run.length) {
                runs.push(run);
                run = [];
              }
            }
            if (run.length) runs.push(run);
            return (
              <g key={s.name}>
                {runs.map((r, ri) => (
                  <g key={ri}>
                    {s.kind === "area" && r.length > 1 && (
                      <path d={`M${r[0][0]},${zero}L${r.map((p) => p.join(",")).join("L")}L${r[r.length - 1][0]},${zero}Z`} fill={s.color} opacity={0.12} />
                    )}
                    <path d={`M${r.map((p) => p.join(",")).join("L")}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 5" : undefined} />
                  </g>
                ))}
                {!compact && !s.dashed && !s.plain && pts.map((p, i) => p && (hover === i || labels.length <= 13) && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 3.5} fill={s.color} stroke={SURFACE} strokeWidth={2} />)}
                {hover !== null && pts[hover] && s.dashed && <circle cx={pts[hover]![0]} cy={pts[hover]![1]} r={5} fill={s.color} stroke={SURFACE} strokeWidth={2} />}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="rp-tooltip" style={{ left: Math.min(x(hover) + 10, width - 170), top: topPad }} role="status">
          <strong>{labels[hover]}</strong>
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
              <b>{fmtFull(s.values[hover] ?? null)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: Array<{ name: string; color: string; dashed?: boolean }> }) {
  if (series.length < 2) return null;
  return (
    <div className="rp-legend">
      {series.map((s) => (
        <span key={s.name}>
          <i className={s.dashed ? "dashed" : ""} style={{ background: s.dashed ? undefined : s.color, borderColor: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Data table behind a chart, so nothing depends on reading colour or hovering. */
export function ChartTable({ labels, series, money = true }: { labels: string[]; series: Series[]; money?: boolean }) {
  return (
    <div className="rp-chart-table">
      <table>
        <thead>
          <tr>
            <th>Period</th>
            {series.map((s) => (
              <th key={s.name} className="num">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}>
              <td>{l}</td>
              {series.map((s) => (
                <td key={s.name} className="num">
                  {s.values[i] === null ? "—" : amount(s.values[i], money ? 2 : 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type Slice = { label: string; amount: number };

export function Donut({ slices, size = 172, label }: { slices: Slice[]; size?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.amount), 0);
  const r = size / 2 - 4;
  const inner = r * 0.5;
  const c = size / 2;
  const count = Math.max(1, slices.length);
  const seg = (a0: number, a1: number) => {
    const pt = (rad: number, a: number) => `${c + rad * Math.sin(a)},${c - rad * Math.cos(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${pt(r, a0)}A${r},${r} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${inner},${inner} 0 ${large} 0 ${pt(inner, a0)}Z`;
  };
  let angle = 0;
  const TWO_PI = Math.PI * 2 - 0.0001;
  return (
    <div className="rp-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {slices.map((s, i) => {
          const share = total > 0 ? Math.max(0, s.amount) / total : 1 / count;
          const a0 = angle;
          const a1 = angle + share * TWO_PI;
          angle = a1;
          if (share === 0) return null;
          return (
            <path
              key={s.label}
              d={seg(a0, a1)}
              fill={total > 0 ? AGE_RAMP[Math.min(i, AGE_RAMP.length - 1)] : "#e2e4e8"}
              stroke={SURFACE}
              strokeWidth={2}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
      {hover !== null && slices[hover] && (
        <div className="rp-tooltip rp-tooltip-center" role="status">
          <strong>{slices[hover].label}</strong>
          <span>
            <b>{amount(slices[hover].amount, 2)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

export const ageColor = (i: number) => AGE_RAMP[Math.min(i, AGE_RAMP.length - 1)];

export function Gauge({ value, size = 150, label }: { value: number | null; size?: number; label: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value));
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2 + 2;
  const arc = (to: number) => {
    const a = Math.PI * (1 - to);
    return `M${cx - r},${cy}A${r},${r} 0 0 1 ${cx + r * Math.cos(a)},${cy - r * Math.sin(a)}`;
  };
  return (
    <div className="rp-gauge" style={{ width: size }}>
      <svg width={size} height={size / 2 + 12} role="img" aria-label={`${label}: ${value === null ? "no data" : `${(pct * 100).toFixed(1)}%`}`}>
        <path d={arc(0.9999)} fill="none" stroke="#dce8fa" strokeWidth={13} strokeLinecap="round" />
        {pct > 0 && <path d={arc(pct)} fill="none" stroke={SERIES[0]} strokeWidth={13} strokeLinecap="round" />}
      </svg>
      <strong>{value === null ? "—" : `${(pct * 100).toFixed(1)}%`}</strong>
    </div>
  );
}

export function ChartError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="rp-chart-error" role="alert">
      <span className="rp-chart-error-icon" aria-hidden="true">
        <ChartLine size={64} strokeWidth={1.75} />
        <CircleX size={28} fill="#1238e6" color="#fff" />
      </span>
      <strong>Something's not right</strong>
      <span>Try again later.</span>
      {onRetry && (
        <button type="button" className="rp-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function StatTile({ label, value, change, invert, hint }: { label: string; value: ReactNode; change?: number | null; invert?: boolean; hint?: string }) {
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <div className="rp-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {change !== undefined && change !== null ? (
        <em className={good ? "good" : "bad"}>
          <span aria-hidden="true">{up ? "▲" : "▼"}</span> {up ? "+" : ""}
          {(change * 100).toFixed(1)}% <small>{hint ?? "vs prior year"}</small>
        </em>
      ) : (
        <em className="flat">{hint ?? "No comparison"}</em>
      )}
    </div>
  );
}
