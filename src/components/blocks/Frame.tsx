import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type FrameVariant = 'quiet' | 'tint' | 'media' | 'terminal' | 'bare'

/**
 * The single frame every content box sits in.
 *
 * Variants exist so a slide reads as a page, not a stack of identical
 * rectangles: prose stays quiet, emphasis blocks are tinted, media gets a
 * recessed surface, code stays deliberately dark in every theme.
 */
export function Frame({
  children,
  accent,
  variant = 'quiet',
  className,
  bodyClassName,
  style,
  as: Tag = 'div',
}: {
  children: ReactNode
  accent?: string
  variant?: FrameVariant
  className?: string
  bodyClassName?: string
  style?: React.CSSProperties
  as?: 'div' | 'figure' | 'section' | 'li'
}) {
  const shell = variant === 'bare' ? 'block' : 'block-shell'
  return (
    <Tag
      className={cn(
        shell,
        variant === 'quiet' && 'border-hairline bg-surface shadow-card',
        variant === 'tint' && 'border-transparent shadow-none',
        variant === 'media' && 'border-hairline bg-sunken/70 shadow-card',
        variant === 'terminal' && 'border-slate-900 bg-slate-950 text-emerald-100 shadow-lift',
        className,
      )}
      style={{ ...(style ?? {}), ...(accent ? ({ ['--k-accent' as string]: accent } as React.CSSProperties) : {}) }}
    >
      {variant === 'bare' ? (
        children
      ) : (
        <div
          className={cn(
            'px-4 py-3.5 sm:px-5',
            variant === 'terminal' && 'p-0',
            bodyClassName,
          )}
        >
          {children}
        </div>
      )}
    </Tag>
  )
}

/** Caption line under media / above an answer. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <figcaption className={cn('mt-2 text-center text-xs leading-6 text-ink-3', className)}>{children}</figcaption>
}
