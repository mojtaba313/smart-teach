import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { popOverlay, pushOverlay } from '../../lib/hotkeys'
import { Button, IconButton } from './primitives'

/* ------------------------------------------------------------------ *
 *  Focus utilities
 * ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'

export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
}

/** Traps Tab inside `ref` while `active`. Returns a restore function. */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    const previous = document.activeElement as HTMLElement | null
    const first = focusablesIn(root)[0]
    // Defer so entry transitions don't steal the paint.
    const id = requestAnimationFrame(() => {
      ;(root?.querySelector<HTMLElement>('[data-autofocus]') ?? first ?? root)?.focus()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusablesIn(ref.current)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey && (activeEl === firstEl || !ref.current?.contains(activeEl))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener('keydown', onKey, true)
      if (previous && previous.isConnected) previous.focus()
    }
  }, [ref, active])
}

/** Locks body scroll while an overlay is open. */
export function useScrollLock(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return
    const { overflow, paddingRight } = document.body.style
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [active])
}

/* ------------------------------------------------------------------ *
 *  Modal
 * ------------------------------------------------------------------ */

export type ModalProps = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** hide the close button when the flow must be resolved */
  dismissible?: boolean
  className?: string
  bodyClassName?: string
}

const MODAL_SIZE = {
  sm: 'max-w-sm',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[min(96rem,95vw)]',
} as const

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
  bodyClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(panelRef, open)
  useScrollLock(open)

  // Tell the hotkey registry a modal is up, so page-level shortcuts stand down.
  useEffect(() => {
    if (!open) return
    pushOverlay()
    return () => popOverlay()
  }, [open])

  useEffect(() => {
    if (!open || !dismissible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissible, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-3 sm:p-6">
          <motion.div
            className="fixed inset-0 bg-slate-950/55 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissible ? onClose : undefined}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'relative my-auto w-full overflow-hidden rounded-3xl border border-hairline bg-surface shadow-pop',
              MODAL_SIZE[size],
              className,
            )}
          >
            {(title || dismissible) && (
              <div className="flex items-start gap-3 border-b border-hairline px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2 id={titleId} className="truncate text-base font-black text-ink">
                      {title}
                    </h2>
                  )}
                  {subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>}
                </div>
                {dismissible && <IconButton icon={X} label="بستن" size="sm" onClick={onClose} />}
              </div>
            )}
            <div className={cn('max-h-[min(74vh,60rem)] overflow-y-auto scroll-thin px-5 py-4', bodyClassName)}>
              {children}
            </div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-sunken/60 px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 *  Confirm
 * ------------------------------------------------------------------ */

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'حذف کن',
  cancelLabel = 'انصراف',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'brand'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <span className={cn('flex size-7 items-center justify-center rounded-lg', tone === 'danger' ? 'bg-danger/12 text-danger' : 'bg-brand-soft text-brand')}>
            <AlertTriangle className="size-4" />
          </span>
          {title}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-7 text-ink-2">{body}</div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Toasts
 * ------------------------------------------------------------------ */

export type ToastKind = 'ok' | 'err' | 'info'

export type ToastItem = {
  id: number
  text: string
  kind: ToastKind
  detail?: string
  action?: { label: string; run: () => void }
}

let pushFn: ((t: Omit<ToastItem, 'id'>) => void) | null = null
let seq = 0

export function toast(text: string, kind: ToastKind = 'ok', opts: { detail?: string; action?: ToastItem['action'] } = {}) {
  pushFn?.({ text, kind, detail: opts.detail, action: opts.action })
}

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    pushFn = (t) => {
      seq += 1
      const id = seq
      setItems((xs) => [...xs.slice(-3), { ...t, id }])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.action ? 7000 : 2800)
    }
    return () => {
      pushFn = null
    }
  }, [])

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[120] flex w-[min(28rem,92vw)] -translate-x-1/2 flex-col items-center gap-2"
    >
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'pointer-events-auto flex w-full items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-sm shadow-pop backdrop-blur',
              t.kind === 'err' && 'border-danger/40 bg-danger text-white',
              t.kind === 'ok' && 'border-ok/40 bg-ink text-white',
              t.kind === 'info' && 'border-hairline bg-surface text-ink',
            )}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full',
                t.kind === 'err' ? 'bg-white/20' : t.kind === 'ok' ? 'bg-ok text-white' : 'bg-brand-soft text-brand',
              )}
            >
              {t.kind === 'err' ? <X className="size-3" /> : <Check className="size-3" />}
            </span>
            <span className="min-w-0 flex-1 font-bold">
              <span className="block truncate">{t.text}</span>
              {t.detail && <span className="block truncate text-xs opacity-75">{t.detail}</span>}
            </span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run()
                  dismiss(t.id)
                }}
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-black hover:bg-white/25"
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 *  Menu — keyboard-navigable dropdown
 * ------------------------------------------------------------------ */

export type MenuItem =
  | { type: 'item'; key: string; label: string; hint?: string; icon?: ReactElement; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { type: 'label'; key: string; label: string }
  | { type: 'sep'; key: string }

/**
 * Keyboard-navigable dropdown.
 *
 * The panel is portalled to `<body>` and positioned with fixed coordinates.
 * That is not gold-plating: block cards carry `overflow-hidden` for their
 * rounded corners, so an in-flow dropdown gets clipped by its own card.
 *
 * `↑`/`↓`/`Home`/`End` move, `Enter` activates, `Esc` closes and returns
 * focus to the trigger.
 */
export function Menu({
  label,
  icon,
  items,
  align = 'start',
  triggerClassName,
  triggerSize = 'md',
  menuWidth = 240,
  disabled,
}: {
  label: string
  icon?: LucideIcon
  items: MenuItem[]
  align?: 'start' | 'end'
  triggerClassName?: string
  triggerSize?: 'sm' | 'md' | 'lg'
  menuWidth?: number
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  /** anchored under the trigger, flipped above when there is no room below */
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLButtonElement[]>([])

  /** Keyboard-focusable items, in visual order — precomputed so render stays pure. */
  const flat = useMemo(
    () => items.filter((item): item is Extract<MenuItem, { type: 'item' }> => item.type === 'item' && !item.disabled),
    [items],
  )

  const focusableIndex = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const item of items) {
      if (item.type === 'item' && !item.disabled) map.set(item.key, n++)
    }
    return map
  }, [items])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setPos(null)
    if (refocus) btnRef.current?.focus()
  }, [])

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const GAP = 6
    const EDGE = 8
    const estH = Math.min(items.length * 40 + 16, 352)
    // The panel scrolls internally, so it must never grow past the room on the
    // side it opens on — otherwise the tail is off-screen and, because a page
    // scroll closes the menu, unreachable.
    const cap = Math.min(352, Math.round(window.innerHeight * 0.7))
    const roomBelow = window.innerHeight - r.bottom - GAP - EDGE
    const roomAbove = r.top - GAP - EDGE
    const openUp = roomBelow < estH && roomAbove > roomBelow
    const maxH = Math.max(132, Math.min(cap, openUp ? roomAbove : roomBelow))
    const top = openUp ? Math.max(EDGE, r.top - GAP - maxH) : Math.min(r.bottom + GAP, window.innerHeight - EDGE - maxH)
    // `align="end"` lines the panel's trailing edge up with the trigger's.
    const rawLeft = align === 'end' ? r.right - menuWidth : r.left
    setPos({
      top: Math.max(EDGE, top),
      left: Math.max(EDGE, Math.min(rawLeft, window.innerWidth - menuWidth - EDGE)),
      maxH,
    })
  }, [align, menuWidth, items.length])

  useEffect(() => {
    if (!open) return
    place()
    const onAway = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onReflow = () => setOpen(false)
    // A fixed-position panel must close when the page scrolls under it — but the
    // listener is in the capture phase so it also sees the panel's *own*
    // scrolling. Closing on that made a long menu unscrollable: the first wheel
    // tick shut it. Keyboard focus scrolling had the same effect.
    const onScroll = (e: Event) => {
      // `e.target` is the window itself for a scroll on the document, which
      // `contains` rejects — so only test real nodes.
      const el = e.target
      if (el instanceof Node && (panelRef.current?.contains(el) || btnRef.current?.contains(el))) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onAway)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onAway)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, place])

  // An open menu counts as an overlay so page shortcuts stand down.
  useEffect(() => {
    if (open) pushOverlay()
    return () => {
      if (open) popOverlay()
    }
  }, [open])

  // The panel only mounts once `pos` is known (placement needs a layout pass),
  // so focus has to wait for `pos` — keying on `open` alone leaves focus on
  // the trigger and the arrows appear dead.
  useEffect(() => {
    if (!open || !pos) return
    const id = requestAnimationFrame(() => itemsRef.current[0]?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, pos])

  useEffect(() => {
    if (open && pos) itemsRef.current[active]?.focus()
  }, [active, open, pos])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length) setActive((a) => (a + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length) setActive((a) => (a - 1 + flat.length) % flat.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(0, flat.length - 1))
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  const Icon = icon

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setActive(0)
          setOpen((o) => !o)
        }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-xl text-ink-3 transition hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40',
          triggerSize === 'sm' ? 'size-7' : triggerSize === 'lg' ? 'size-11' : 'size-8',
          open && 'bg-sunken text-ink',
          triggerClassName,
        )}
      >
        {Icon ? <Icon className={triggerSize === 'sm' ? 'size-3.5' : 'size-4'} /> : null}
      </button>

      {open &&
        pos &&
        createPortal(
          <motion.div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ top: pos.top, left: pos.left, width: menuWidth, maxHeight: pos.maxH }}
            initial={{ opacity: 0, y: pos.top > 120 ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="fixed z-[110] overflow-y-auto overscroll-contain scroll-thin rounded-2xl border border-hairline bg-surface p-1 shadow-pop"
          >
            {items.map((item) => {
              if (item.type === 'sep') return <div key={item.key} className="my-1 h-px bg-hairline" />
              if (item.type === 'label')
                return (
                  <div key={item.key} className="px-2.5 pb-1 pt-2 text-2xs font-black uppercase tracking-wide text-ink-3">
                    {item.label}
                  </div>
                )
              if (item.disabled)
                return (
                  <div key={item.key} className="cursor-not-allowed rounded-xl px-2.5 py-2 text-xs font-bold text-ink-3/60">
                    {item.label}
                  </div>
                )
              const idx = focusableIndex.get(item.key) ?? 0
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  ref={(el) => {
                    if (el) itemsRef.current[idx] = el
                  }}
                  onClick={() => {
                    item.onSelect()
                    close()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-xs font-bold transition',
                    item.danger ? 'text-danger hover:bg-danger/10' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                  )}
                >
                  {item.icon && <span className="shrink-0 [&>svg]:size-4">{item.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="kbd shrink-0">{item.hint}</span>}
                </button>
              )
            })}
          </motion.div>,
          document.body,
        )}
    </>
  )
}
