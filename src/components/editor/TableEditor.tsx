'use client'

import { Plus, Trash2 } from 'lucide-react'
import type { TableStep } from '../../types'
import { cn } from '../../lib/utils'
import { Button, Field, Input, Switch } from '../ui/primitives'

/**
 * A spreadsheet-shaped editor for the table block.
 *
 * The grid is edited in place rather than through a markdown-ish textarea,
 * because the one thing a table gets wrong is alignment: a student comparing
 * two columns needs them to line up, and hand-editing text cannot guarantee
 * that.
 */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs leading-relaxed text-ink-3">{children}</p>
}

export function TableEditor({
  step,
  onChange,
}: {
  step: TableStep
  onChange: (k: string, v: unknown) => void
}) {
  const rows = step.rows.length > 0 ? step.rows : [['']]
  const cols = Math.max(1, ...rows.map((r) => r.length))

  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row, ri) => {
      const copy = Array.from({ length: cols }, (_, ci) => row[ci] ?? '')
      if (ri === r) copy[c] = value
      return copy
    })
    onChange('rows', next)
  }

  const addRow = () => onChange('rows', [...rows, new Array(cols).fill('')])

  const removeRow = (r: number) => {
    if (rows.length <= 1) return
    onChange('rows', rows.filter((_, i) => i !== r))
  }

  const addCol = () => onChange('rows', rows.map((row) => [...row, '']))

  const removeCol = (c: number) => {
    if (cols <= 1) return
    onChange('rows', rows.map((row) => row.filter((_, i) => i !== c)))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          label="سطر اول عنوان است"
          checked={step.header !== false}
          onChange={(v) => onChange('header', v)}
        />
        <Switch label="فشرده" checked={step.compact === true} onChange={(v) => onChange('compact', v)} />
        <Switch
          label="پررنگ‌کردن سطر آخر"
          checked={step.emphasizeLastRow === true}
          onChange={(v) => onChange('emphasizeLastRow', v)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="border-s border-hairline p-0">
                    <input
                      value={row[c] ?? ''}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      aria-label={`سطر ${r + 1} ستون ${c + 1}`}
                      className={cn(
                        'h-8 w-full min-w-24 bg-transparent px-2 text-xs outline-none focus:bg-brand-soft/20',
                        step.header !== false && r === 0 && 'font-bold',
                      )}
                    />
                  </td>
                ))}
                <td className="p-0">
                  <button
                    type="button"
                    onClick={() => removeRow(r)}
                    disabled={rows.length <= 1}
                    aria-label={`حذف سطر ${r + 1}`}
                    className="grid h-8 w-7 place-items-center text-ink-3 hover:text-danger disabled:opacity-30"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={addRow} icon={Plus}>
          سطر
        </Button>
        <Button size="sm" variant="ghost" onClick={addCol} icon={Plus}>
          ستون
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => removeCol(cols - 1)}
          disabled={cols <= 1}
          icon={Trash2}
        >
          حذف ستون آخر
        </Button>
      </div>

      <Field label="توضیح زیر جدول">
        <Input
          value={step.caption ?? ''}
          onChange={(e) => onChange('caption', e.target.value)}
          className="h-8 text-xs"
        />
      </Field>
      <Hint>با نوشتن $فرمول$ می‌توانید داخل خانه فرمول بگذارید.</Hint>
    </div>
  )
}
