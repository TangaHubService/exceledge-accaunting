/** Simple CSS/SVG art for the employees empty hero (no external asset required). */
export function EmployeesIllustration() {
  return (
    <div className="ee-team-illu" aria-hidden="true">
      <svg viewBox="0 0 360 260" className="ee-team-illu-svg" role="img">
        <defs>
          <linearGradient id="ee-team-desk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dbe7f8" />
            <stop offset="100%" stopColor="#c5d6ef" />
          </linearGradient>
        </defs>
        <ellipse cx="180" cy="230" rx="130" ry="16" fill="#d7e4f6" opacity="0.7" />
        <rect x="70" y="168" width="220" height="48" rx="8" fill="url(#ee-team-desk)" />
        <rect x="130" y="128" width="100" height="48" rx="6" fill="#1e3a5f" />
        <rect x="138" y="134" width="84" height="32" rx="3" fill="#7eb6ff" />
        <rect x="155" y="176" width="50" height="8" rx="2" fill="#94a9c4" />
        {/* Person left */}
        <circle cx="110" cy="108" r="22" fill="#f0c9a8" />
        <path d="M88 168c0-28 12-44 44-44s44 16 44 44" fill="#2f6fed" />
        <rect x="98" y="95" width="24" height="10" rx="4" fill="#1a2744" />
        {/* Person right */}
        <circle cx="250" cy="112" r="20" fill="#e8b896" />
        <path d="M228 168c0-26 12-40 40-40s40 14 40 40" fill="#0b2a4a" />
        <path d="M232 100c8-14 28-14 36 0" fill="#4a3728" />
        {/* Floating cards */}
        <g transform="translate(28 36)">
          <rect width="86" height="52" rx="8" fill="#fff" stroke="#e2eaf5" />
          <circle cx="22" cy="26" r="12" fill="#c7dbf7" />
          <rect x="40" y="16" width="34" height="7" rx="2" fill="#0b2a4a" opacity="0.75" />
          <rect x="40" y="28" width="28" height="5" rx="2" fill="#98a2b3" opacity="0.6" />
        </g>
        <g transform="translate(248 48)">
          <rect width="86" height="52" rx="8" fill="#fff" stroke="#e2eaf5" />
          <circle cx="22" cy="26" r="12" fill="#f5d0b8" />
          <rect x="40" y="16" width="34" height="7" rx="2" fill="#0b2a4a" opacity="0.75" />
          <rect x="40" y="28" width="28" height="5" rx="2" fill="#98a2b3" opacity="0.6" />
        </g>
        {/* Plant */}
        <rect x="300" y="148" width="22" height="28" rx="3" fill="#c4d4ea" />
        <ellipse cx="311" cy="138" rx="14" ry="18" fill="#3d9b6e" />
        <ellipse cx="300" cy="142" rx="10" ry="12" fill="#2f7a56" />
      </svg>
    </div>
  );
}
