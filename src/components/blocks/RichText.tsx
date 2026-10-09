import { Fragment, memo, type ReactNode } from 'react'
import { InlineMath } from 'react-katex'
import { cn } from '../../lib/utils'

/**
 * A deliberately tiny inline markup language — enough for real teaching notes
 * without pulling in a Markdown parser:
 *
 *   **پررنگ**      *مورب*      `کد`      ==هایلایت==      $x = vt$
 *
 * Bare URLs become links. Latin/mixed runs are bidi-isolated so a formula or
 * a code span never flips the surrounding Persian line.
 */

const PATTERN = /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(==[^=\n]+==)|(\$[^$\n]+\$)|((?:https?:\/\/|www\.)[^\s<>"']+)/g

const URL_RE = /^(?:https?:\/\/|www\.)[^\s<>"']+$/

export function RichText({
  value,
  className,
  as: Tag = 'p',
}: {
  value: string
  className?: string
  as?: 'p' | 'span' | 'div' | 'li' | 'dd'
}) {
  const nodes = renderRich(value)
  return <Tag className={className}>{nodes}</Tag>
}

export function renderRich(value: string): ReactNode[] {
  if (!value) return []
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  PATTERN.lastIndex = 0
  let k = 0
  const push = (node: ReactNode) => out.push(node)
  while ((m = PATTERN.exec(value)) !== null) {
    if (m.index > last) out.push(<Fragment key={k++}>{value.slice(last, m.index)}</Fragment>)
    const tok = m[0]
    if (m[1]) out.push(<strong key={k++} className="font-black text-ink">{tok.slice(2, -2)}</strong>)
    else if (m[2]) out.push(<em key={k++} className="font-semibold italic">{tok.slice(1, -1)}</em>)
    else if (m[3]) out.push(<code key={k++} className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.85em] text-accent" dir="ltr">{tok.slice(1, -1)}</code>)
    else if (m[4]) out.push(<mark key={k++} className="rounded bg-brand-soft px-1 py-0.5 text-ink">{tok.slice(2, -2)}</mark>)
    else if (m[5]) out.push(<Math key={k++} math={tok.slice(1, -1)} />)
    else if (URL_RE.test(tok)) {
      const href = tok.startsWith('www.') ? `https://${tok}` : tok
      out.push(
        <a
          key={k++}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-bold text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          dir="ltr"
        >
          {tok}
        </a>,
      )
    }
    last = m.index + tok.length
  }
  if (last < value.length) push(<Fragment key={k}>{value.slice(last)}</Fragment>)
  return out
}

/** Inline KaTeX that degrades to plain text when the formula is malformed. */
export const Math = memo(function Math({ math, className }: { math: string; className?: string }) {
  return (
    <span dir="ltr" className={cn('mx-0.5 inline-block align-middle', className)} style={{ unicodeBidi: 'isolate' }}>
      <InlineMath math={math} errorColor="rgb(var(--danger))" />
    </span>
  )
})
