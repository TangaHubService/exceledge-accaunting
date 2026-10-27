/** Shared colour tokens for the printable invoice (inline styles only, so it
 *  renders identically in the browser, in html2canvas captures and in print). */

export const C = {
  navy: "#1D4ED8",
  deep: "#1E40AF",
  darker: "#172EA6",
  tint: "#EAF1FF",
  tint2: "#F6F9FF",
  ink: "#111827",
  body: "#374151",
  muted: "#6B7280",
  faint: "#9CA3AF",
  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  green: "#059669",
  greenTint: "#ECFDF5",
  greenSoft: "#D1FAE5",
  flag: { blue: "#00A1DE", yellow: "#FACB0E", green: "#3BB13B" },
  white: "#FFFFFF",
} as const

export const fontSize = {
  xs: 9.5,
  sm: 11,
  md: 12,
  lg: 13.5,
} as const