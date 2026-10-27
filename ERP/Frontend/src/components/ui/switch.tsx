'use client'

import { AppToggle } from './AppToggle'
import type { AppToggleColor, AppToggleSize } from './AppToggle'

/**
 * Back-compat shim: every existing call site in the app was written against
 * Radix's raw Switch API (`onCheckedChange`). Routing it through AppToggle
 * means the standardized design applies everywhere this is used without
 * touching each call site individually. New code should import AppToggle
 * directly and use `onChange` instead.
 */
export interface SwitchProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  loading?: boolean
  size?: AppToggleSize
  color?: AppToggleColor
  id?: string
  name?: string
  className?: string
}

function Switch({ checked = false, onCheckedChange, ...props }: SwitchProps) {
  return <AppToggle checked={checked} onChange={onCheckedChange} {...props} />
}

export { Switch }
