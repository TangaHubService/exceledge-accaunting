import { cn } from '../../lib/utils'
import { Check } from 'lucide-react'

export interface Step {
  id: string
  label: string
  status: 'complete' | 'incomplete' | 'error'
}

interface StepIndicatorProps {
  steps: Step[]
  activeStep: string
  onStepClick?: (stepId: string) => void
}

export function StepIndicator({ steps, activeStep, onStepClick }: StepIndicatorProps) {
  return (
    <nav aria-label="Form progress" className="w-full">
      <ol className="flex items-center gap-1">
        {steps.map((step, index) => {
          const isActive = step.id === activeStep
          const isClickable = !!onStepClick

          return (
            <li key={step.id} className="flex items-center gap-1 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => isClickable && onStepClick?.(step.id)}
                disabled={!isClickable}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all min-w-0',
                  isActive && 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100',
                  !isActive && step.status === 'complete' && 'text-emerald-600 dark:text-emerald-400',
                  !isActive && step.status === 'error' && 'text-red-600 dark:text-red-400',
                  !isActive && step.status === 'incomplete' && 'text-gray-400 dark:text-gray-500',
                  isClickable && !isActive && 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer',
                  !isClickable && 'cursor-default',
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                {/* Step number / icon */}
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    step.status === 'complete' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                    step.status === 'error' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                    step.status === 'incomplete' && isActive && 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
                    step.status === 'incomplete' && !isActive && 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
                  )}
                >
                  {step.status === 'complete' ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    index + 1
                  )}
                </span>

                {/* Label — hidden on mobile */}
                <span className="hidden sm:inline truncate">
                  {step.label}
                </span>
              </button>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'h-px flex-1 min-w-[8px] mx-1',
                    step.status === 'complete'
                      ? 'bg-emerald-300 dark:bg-emerald-700'
                      : 'bg-gray-200 dark:bg-gray-700',
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
