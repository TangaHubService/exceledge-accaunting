/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: [
                    'Inter',
                    'system-ui',
                    '-apple-system',
                    'BlinkMacSystemFont',
                    'Segoe UI',
                    'Roboto',
                    'sans-serif',
                ],
            },

            colors: {
                // ── Brand / Chrome ───────────────────────────────────
                chrome: {
                    950: '#0a1628',
                    900: '#0f2744',
                    800: '#1a365d',
                    700: '#2a4a7f',
                },

                // ── Primary accent ───────────────────────────────────
                accent: {
                    DEFAULT: '#2563eb',
                    foreground: '#ffffff',
                    50:  '#eff6ff',
                    100: '#dbeafe',
                    200: '#bfdbfe',
                    500: '#3b82f6',
                    600: '#2563eb',
                    700: '#1d4ed8',
                    900: '#1e3a8a',
                },

                // ── shadcn/ui semantic tokens ─────────────────────────
                // These back the base `<Button>`, `<Badge>`, `<Select>`, `<Input>`,
                // `<Alert>` etc. variants (bg-primary, text-muted-foreground, ...).
                // They were never wired up, so those variants silently rendered
                // with no color at all. Values are CSS vars set in index.css.
                border: 'hsl(var(--border) / <alpha-value>)',
                input: 'hsl(var(--input) / <alpha-value>)',
                ring: 'hsl(var(--ring) / <alpha-value>)',
                background: 'hsl(var(--background) / <alpha-value>)',
                foreground: 'hsl(var(--foreground) / <alpha-value>)',
                primary: {
                    DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
                    foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
                    foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
                    foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
                    foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
                },
                card: {
                    DEFAULT: 'hsl(var(--card) / <alpha-value>)',
                    foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
                    foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
                },

                // ── Inventory health ─────────────────────────────────
                stock: {
                    safe:    { DEFAULT: '#059669', light: '#d1fae5', dark: '#065f46' },
                    low:     { DEFAULT: '#d97706', light: '#fef3c7', dark: '#92400e' },
                    out:     { DEFAULT: '#dc2626', light: '#fee2e2', dark: '#991b1b' },
                },

                // ── Expiry ───────────────────────────────────────────
                expiry: {
                    fresh:   '#059669',
                    warning: '#d97706',
                    expired: '#dc2626',
                },

                // ── Branch / multi-tenant ────────────────────────────
                branch: {
                    primary:   '#2563eb',
                    secondary: '#7c3aed',
                    inactive:  '#94a3b8',
                    suspended: '#dc2626',
                },

                // ── Surface ──────────────────────────────────────────
                surface: {
                    DEFAULT:    '#ffffff',
                    muted:      '#f8fafc',
                    dark:       '#0c0a09',
                    'dark-muted': '#1c1917',
                },
            },

            fontSize: {
                'display': ['2.25rem', { lineHeight: '1.15', fontWeight: '700' }],
                'h1':      ['1.5rem',  { lineHeight: '1.25', fontWeight: '600' }],
                'h2':      ['1.125rem',{ lineHeight: '1.3',  fontWeight: '600' }],
                'h3':      ['0.9375rem',{ lineHeight: '1.35', fontWeight: '600' }],
                'body':    ['0.875rem', { lineHeight: '1.5',  fontWeight: '400' }],
                'body-sm': ['0.8125rem',{ lineHeight: '1.4',  fontWeight: '400' }],
                'caption': ['0.75rem',  { lineHeight: '1.3',  fontWeight: '500' }],
                'overline':['0.6875rem',{ lineHeight: '1.2',  fontWeight: '600' }],
            },

            boxShadow: {
                'card':     '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
                'dropdown': '0 4px 16px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
                'modal':    '0 20px 60px -12px rgb(0 0 0 / 0.25)',
                'sticky':   '0 -1px 3px 0 rgb(0 0 0 / 0.04)',
            },

            borderRadius: {
                'card':  '0.75rem',
                'badge': '0.375rem',
            },
        },
    },
    plugins: [
        require("tailwindcss-animate"),
    ],
}