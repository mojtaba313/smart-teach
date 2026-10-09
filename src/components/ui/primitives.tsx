import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/* ------------------------------------------------------------------ *
 *  Button
 * ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost' | 'subtle' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand/90 shadow-card',
  accent: 'bg-accent text-on-accent hover:bg-accent/90 shadow-card',
  outline: 'border border-hairline bg-surface text-ink hover:bg-sunken',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  subtle: 'bg-sunken text-ink-2 hover:bg-hairline/70 hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-card',
}

const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 rounded-lg px-2 text-2xs',
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
  md: 'h-9.5 gap-2 rounded-xl px-3.5 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-base',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconEnd?: LucideIcon
  block?: boolean
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', icon: Icon, iconEnd: IconEnd, block, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-bold whitespace-nowrap transition-all duration-150',
        'active:scale-[0.975] disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : Icon ? <Icon className={cn(size === 'xs' ? 'size-3.5' : 'size-4', 'shrink-0')} /> : null}
      {children}
      {IconEnd ? <IconEnd className={cn(size === 'xs' ? 'size-3.5' : 'size-4', 'shrink-0')} /> : null}
    </button>
  )
})

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  /** Required — this is the accessible name. */
  label: string
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
}

const ICON_SIZE = { sm: 'size-7', md: 'size-9', lg: 'size-11' } as const
const ICON_ICON = { sm: 'size-4', md: 'size-[18px]', lg: 'size-5' } as const

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  active,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl transition-all duration-150 active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        ICON_SIZE[size],
        variant === 'ghost' && !active && 'text-ink-3 hover:bg-sunken hover:text-ink',
        variant === 'ghost' && active && 'bg-brand-soft text-brand',
        variant === 'outline' && 'border border-hairline bg-surface text-ink-2 hover:bg-sunken hover:text-ink',
        variant === 'subtle' && 'bg-sunken text-ink-2 hover:text-ink',
        variant === 'primary' && 'bg-brand text-on-brand hover:bg-brand/90',
        variant === 'danger' && 'text-danger hover:bg-danger/10',
        className,
      )}
      {...rest}
    >
      <Icon className={ICON_ICON[size]} />
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70',
        className,
      )}
    />
  )
}

/* ------------------------------------------------------------------ *
 *  Form fields
 * ------------------------------------------------------------------ */

const CONTROL =
  'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none transition ' +
  'placeholder:text-ink-3/70 focus:border-brand/70 focus:ring-2 focus:ring-brand/20 disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-9.5', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(CONTROL, 'resize-y leading-7', className)} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, 'h-9.5 cursor-pointer appearance-none bg-no-repeat pe-8', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'left 0.6rem center',
        backgroundSize: '1rem',
      }}
      {...rest}
    >
      {children}
    </select>
  )
})

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  action,
}: {
  label?: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || action) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-xs font-bold text-ink-2">
              {label}
            </label>
          )}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-xs font-bold text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-5 text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-hairline-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'start-0.5' : 'start-4.5',
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-sm font-bold text-ink">{label}</span>
        {hint && <span className="block text-xs leading-5 text-ink-3">{hint}</span>}
      </label>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Segmented control — radio group with arrow-key navigation
 * ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: LucideIcon; title?: string }[]
  size?: 'sm' | 'md'
  label?: string
  className?: string
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end']
    if (!keys.includes(e.key.toLowerCase())) return
    e.preventDefault()
    const idx = options.findIndex((o) => o.value === value)
    let next = idx
    if (e.key === 'arrowleft' || e.key === 'arrowup') next = idx - 1
    if (e.key === 'arrowright' || e.key === 'arrowdown') next = idx + 1
    if (e.key === 'home') next = 0
    if (e.key === 'end') next = options.length - 1
    const target = options[(next + options.length) % options.length]
    if (target) onChange(target.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex items-center gap-0.5 rounded-xl border border-hairline bg-sunken p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg font-bold transition-all duration-150',
              size === 'sm' ? 'h-7 px-2 text-2xs' : 'h-8 px-3 text-xs',
              active ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Presentational bits
 * ------------------------------------------------------------------ */

const BADGE_TONE = {
  neutral: 'bg-sunken text-ink-2',
  brand: 'bg-brand-soft text-brand',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok/12 text-ok',
  danger: 'bg-danger/12 text-danger',
} as const

export function Badge({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  children: ReactNode
  tone?: keyof typeof BADGE_TONE
  icon?: LucideIcon
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-bold',
        BADGE_TONE[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  )
}

export function Empty({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-hairline px-6 py-12 text-center', className)}>
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-2xl bg-sunken text-ink-3">
          <Icon className="size-6" />
        </span>
      )}
      <div>
        <p className="text-sm font-black text-ink">{title}</p>
        {body && <p className="mx-auto mt-1 max-w-sm text-xs leading-6 text-ink-3">{body}</p>}
      </div>
      {action}
    </div>
  )
}

