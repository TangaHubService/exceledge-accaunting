import type { CSSProperties } from "react"
import { cn } from "../../../lib/utils"

const BLUE = "#1D4ED8"
const GREEN = "#16A34A"
const ORANGE = "#F97316"

/** Rwanda-inspired flag accent bar (blue / yellow / green). */
export function FlagBar({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        height: 4,
        width: "100%",
        overflow: "hidden",
        borderRadius: 999,
        ...style,
      }}
      className={className}
      aria-hidden="true"
    >
      <span style={{ height: "100%", flex: 1, background: "#00A1DE" }} />
      <span style={{ height: "100%", flex: 1, background: "#FACB0E" }} />
      <span style={{ height: "100%", flex: 1, background: "#3BB13B" }} />
    </div>
  )
}

/** Stylized RRA EBM seal with certified / not-certified states. */
export function EbmSeal({
  certified,
  size = 96,
  className,
}: {
  certified?: boolean
  size?: number
  className?: string
}) {
  const ring = certified ? BLUE : "#94A3B8"
  const check = certified ? GREEN : "#CBD5E1"

  return (
    <svg
      viewBox="0 0 132 132"
      width={size}
      height={size}
      className={cn("block", className)}
      role="img"
      aria-label={certified ? "RRA EBM Certified" : "RRA EBM Not certified"}
    >
      <circle cx="66" cy="66" r="58" fill="#fff" stroke={ring} strokeWidth="4" />
      <circle
        cx="66"
        cy="66"
        r="50"
        fill="none"
        stroke={check}
        strokeWidth="4"
        strokeDasharray="8 5"
        strokeLinecap="round"
      />
      <path
        d="M48 65.5 60 78l26-30"
        fill="none"
        stroke={check}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="66"
        y="98"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
        fontSize="28"
        fill={ring}
      >
        EBM
      </text>
    </svg>
  )
}

/** RRA mark with the orange "RRA" wordmark. */
export function RraMark({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 180 160"
      className={cn("block", className)}
      style={style}
      role="img"
      aria-label="Rwanda Revenue Authority"
    >
      <defs>
        <linearGradient id="rra-blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id="rra-orange" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#FB923C" />
        </linearGradient>
        <linearGradient id="rra-green" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#16A34A" />
          <stop offset="100%" stopColor="#4ADE80" />
        </linearGradient>
      </defs>
      <g transform="translate(12 8)">
        <ellipse cx="36" cy="28" rx="11" ry="28" fill="url(#rra-blue)" transform="rotate(-36 36 28)" opacity="0.98" />
        <ellipse cx="70" cy="18" rx="11" ry="28" fill="url(#rra-green)" transform="rotate(24 70 18)" opacity="0.98" />
        <ellipse cx="20" cy="70" rx="11" ry="28" fill="url(#rra-orange)" transform="rotate(-28 20 70)" opacity="0.98" />
        <ellipse cx="52" cy="58" rx="11" ry="28" fill="url(#rra-blue)" transform="rotate(20 52 58)" opacity="0.92" />
        <ellipse cx="72" cy="52" rx="11" ry="28" fill="url(#rra-orange)" transform="rotate(54 72 52)" opacity="0.96" />
        <ellipse cx="48" cy="88" rx="11" ry="28" fill="url(#rra-green)" transform="rotate(16 48 88)" opacity="0.96" />
        <circle cx="51" cy="60" r="7" fill={BLUE} />
        <circle cx="51" cy="60" r="3.4" fill="#FFFFFF" opacity="0.95" />
        <path d="M51 59c6 11 13 19 24 28" fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
      </g>
      <text
        x="95"
        y="114"
        textAnchor="start"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
        fontSize="30"
        fill={ORANGE}
        letterSpacing="0.5"
      >
        RRA
      </text>
    </svg>
  )
}