import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Standardized on/off control for every Active/Inactive, Enabled/Disabled
 * boolean in the app. Built on Radix's Switch primitive so role="switch",
 * aria-checked, and Space/Enter keyboard handling come for free — only the
 * visuals (track/thumb sizing, colors, transitions, loading dot) live here.
 */

export type AppToggleSize = 'small' | 'medium' | 'large'
export type AppToggleColor = 'primary' | 'success' | 'danger' | 'warning'

// NOTE: the checked-translate classes must appear as full literal strings
// (not built via concatenation) so Tailwind's static scanner emits the
// `data-[state=checked]:*` variant utilities at build time.
const SIZES: Record<AppToggleSize, { track: string; thumb: string; checkedTranslate: string; loader: string }> = {
  small: { track: 'h-5 w-9', thumb: 'size-4', checkedTranslate: 'data-[state=checked]:translate-x-4', loader: 'size-2.5' },
  medium: { track: 'h-6 w-11', thumb: 'size-5', checkedTranslate: 'data-[state=checked]:translate-x-5', loader: 'size-3' },
  large: { track: 'h-[30px] w-14', thumb: 'size-[26px]', checkedTranslate: 'data-[state=checked]:translate-x-6', loader: 'size-4' },
}

const COLORS: Record<AppToggleColor, { border: string; borderHover: string; bg: string; bgHover: string; ring: string; thumbOff: string; text: string }> = {
  primary: {
    border: 'border-blue-600 dark:border-blue-500',
    borderHover: 'hover:border-blue-700 dark:hover:border-blue-400',
    bg: 'data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-blue-500',
    bgHover: 'hover:data-[state=checked]:bg-blue-700 dark:hover:data-[state=checked]:bg-blue-400',
    ring: 'focus-visible:ring-blue-500',
    thumbOff: 'bg-blue-600 dark:bg-blue-500',
    text: 'text-blue-600 dark:text-blue-500',
  },
  success: {
    border: 'border-emerald-600 dark:border-emerald-500',
    borderHover: 'hover:border-emerald-700 dark:hover:border-emerald-400',
    bg: 'data-[state=checked]:bg-emerald-600 dark:data-[state=checked]:bg-emerald-500',
    bgHover: 'hover:data-[state=checked]:bg-emerald-700 dark:hover:data-[state=checked]:bg-emerald-400',
    ring: 'focus-visible:ring-emerald-500',
    thumbOff: 'bg-emerald-600 dark:bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-500',
  },
  danger: {
    border: 'border-red-600 dark:border-red-500',
    borderHover: 'hover:border-red-700 dark:hover:border-red-400',
    bg: 'data-[state=checked]:bg-red-600 dark:data-[state=checked]:bg-red-500',
    bgHover: 'hover:data-[state=checked]:bg-red-700 dark:hover:data-[state=checked]:bg-red-400',
    ring: 'focus-visible:ring-red-500',
    thumbOff: 'bg-red-600 dark:bg-red-500',
    text: 'text-red-600 dark:text-red-500',
  },
  warning: {
    border: 'border-amber-600 dark:border-amber-500',
    borderHover: 'hover:border-amber-700 dark:hover:border-amber-400',
    bg: 'data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500',
    bgHover: 'hover:data-[state=checked]:bg-amber-700 dark:hover:data-[state=checked]:bg-amber-400',
    ring: 'focus-visible:ring-amber-500',
    thumbOff: 'bg-amber-600 dark:bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
  },
}

export interface AppToggleProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  loading?: boolean
  size?: AppToggleSize
  color?: AppToggleColor
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

export const AppToggle = React.forwardRef<HTMLButtonElement, AppToggleProps>(
  (
    {
      checked,
      onChange,
      disabled = false,
      loading = false,
      size = 'medium',
      color = 'primary',
      id,
      name,
      className,
      ...aria
    },
    ref,
  ) => {
    const s = SIZES[size]
    const c = COLORS[color]
    const isInteractive = !disabled && !loading

    return (
      <SwitchPrimitive.Root
        ref={ref}
        id={id}
        name={name}
        checked={checked}
        onCheckedChange={(next) => isInteractive && onChange?.(next)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full',
          'border-2 bg-white dark:bg-gray-900',
          'transition-colors duration-[220ms] ease-in-out',
          'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // 44x44 minimum touch target without inflating the visual track
          'before:absolute before:content-[""]',
          size === 'small' && 'before:-inset-x-2 before:-inset-y-3',
          size === 'medium' && 'before:inset-x-0 before:-inset-y-2.5',
          size === 'large' && 'before:inset-x-0 before:-inset-y-1.5',
          s.track,
          c.border,
          isInteractive && c.borderHover,
          c.bg,
          isInteractive && c.bgHover,
          c.ring,
          className,
        )}
        {...aria}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none relative flex translate-x-0 items-center justify-center rounded-full shadow-sm',
            'transition-transform duration-[220ms] ease-in-out',
            s.thumb,
            s.checkedTranslate,
            checked ? 'bg-white' : c.thumbOff,
          )}
        >
          {loading && (
            <Loader2
              className={cn('animate-spin', s.loader, checked ? c.text : 'text-white')}
            />
          )}
        </SwitchPrimitive.Thumb>
      </SwitchPrimitive.Root>
    )
  },
)
AppToggle.displayName = 'AppToggle'
