import { describe, expect, it } from 'vitest'
import { migratePresentation } from './migrate'
import { emptyStep } from '../types'
import type { TableStep } from '../types'

const deck = (steps: unknown[]): unknown => ({
  schema: 2,
  id: 'p1',
  title: 't',
  slides: [{ id: 's1', title: 's', steps, notes: '' }],
})

function tableOf(steps: unknown[]): TableStep {
  const m = migratePresentation(deck(steps))
  const step = m!.slides[0].steps.find((s) => s.kind === 'table')
  return step as TableStep
}

describe('table migration', () => {
  it('keeps a well-formed table intact', () => {
    const t = tableOf([
      { id: 't1', kind: 'table', span: 'full', rows: [['a', 'b'], ['1', '2']], header: true },
    ])
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(t.header).toBe(true)
  })

  it('pads a ragged table so columns do not shift left', () => {
    // The failure this prevents is subtle: a short row collapses the grid and
    // every cell to its right slides under the wrong column heading.
    const t = tableOf([{ id: 't1', kind: 'table', span: 'full', rows: [['a', 'b', 'c'], ['1'], ['2', 'x']] }])
    expect(t.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['2', 'x', ''],
    ])
  })

  it('coerces non-string cells rather than dropping the row', () => {
    const t = tableOf([{ id: 't1', kind: 'table', span: 'full', rows: [['n', 5, null, true]] }])
    expect(t.rows).toEqual([['n', '5', '', 'true']])
  })

  it('never yields an empty grid', () => {
    expect(tableOf([{ id: 't1', kind: 'table', span: 'full', rows: [] }]).rows).toEqual([['']])
    expect(tableOf([{ id: 't1', kind: 'table', span: 'full' }]).rows).toEqual([['']])
    expect(tableOf([{ id: 't1', kind: 'table', span: 'full', rows: [[]] }]).rows).toEqual([['']])
  })

  it('defaults the header on and keeps the flags it was given', () => {
    const t = tableOf([
      { id: 't1', kind: 'table', span: 'full', rows: [['a']], compact: true, emphasizeLastRow: true },
    ])
    expect(t.header).toBe(true)
    expect(t.compact).toBe(true)
    expect(t.emphasizeLastRow).toBe(true)
    // Absent flags mean off, not undefined leaking into the renderer.
    expect(tableOf([{ id: 't', kind: 'table', span: 'full', rows: [['a']] }]).compact).toBe(false)
  })

  it('is reachable from the block palette', () => {
    const s = emptyStep('table')
    expect(s.kind).toBe('table')
    if (s.kind === 'table') {
      expect(s.rows).toEqual([
        ['', ''],
        ['', ''],
      ])
    }
  })
})
