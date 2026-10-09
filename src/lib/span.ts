import type { BlockSpan } from '../types'

/**
 * One source of truth for block widths.
 *
 * The slide grid is six columns: `full` takes all of them, `half` three,
 * `third` two. Both the presenter and the editor preview must agree or the
 * preview lies about how a section will look.
 */
export const SPAN_COLS: Record<BlockSpan, number> = { full: 6, half: 3, third: 2 }

/** columns per block, for CSS grid */
export function spanCols(span: BlockSpan): number {
  return SPAN_COLS[span] ?? 6
}

/**
 * Tailwind classes for a block width.
 *
 * Below `md` the grid collapses: half-width blocks go full and third-width
 * blocks go half, so text never has to render in a sliver of a phone screen.
 */
export function spanClass(span: BlockSpan): string {
  if (span === 'full') return 'col-span-6'
  if (span === 'half') return 'col-span-6 md:col-span-3'
  return 'col-span-3 md:col-span-2'
}