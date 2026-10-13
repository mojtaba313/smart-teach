/**
 * The studio's scene toolbar: export, demo files, and the pieces of authoring
 * that do not belong to any single panel.
 *
 * Grouped in one component because these are the operations an author reaches
 * for between two edits rather than ones they set up once — a menu that hides
 * "export PNG" behind three levels is the same as not having it.
 */

'use client'

import { useCallback, useRef, useState } from 'react'
import { Download, FileDown, FileUp, Trash2 } from 'lucide-react'
import type { Animation2 } from '../../types/anim2'
import { download, exportScene, type ExportFormat } from '../../lib/anim2/exporters'
import { demoFilename, parseDemo, serializeDemo, toDemo } from '../../lib/anim2/demo'
import { cn, toFaDigits } from '../../lib/utils'

export function SceneToolbar({
  anim,
  svgRef,
  onImport,
  disabled,
}: {
  anim: Animation2
  /** The live scene element; exports serialise it rather than re-rendering. */
  svgRef: React.RefObject<SVGSVGElement | null>
  /** Receives an imported animation, or null when the file was rejected. */
  onImport: (next: Animation2, warnings: string[]) => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const doExport = useCallback(
    async (format: ExportFormat) => {
      setBusy(format)
      setError(null)
      try {
        const blob = await exportScene(svgRef.current, format)
        download(blob, demoFilename(anim.title || 'scene', format))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'برون‌بری ناکام ماند')
      } finally {
        setBusy(null)
      }
    },
    [anim.title, svgRef],
  )

  const doExportDemo = useCallback(() => {
    const demo = toDemo(anim)
    download(
      new Blob([serializeDemo(demo)], { type: 'application/json' }),
      demoFilename(demo.title, 'demo.json'),
    )
  }, [anim])

  const doImport = useCallback(
    async (file: File) => {
      const text = await file.text()
      const parsed = parseDemo(text)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      setError(null)
      onImport(parsed.demo.animation, parsed.warnings)
    },
    [onImport],
  )

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-2 py-1.5">
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => doExport('png')}
        className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-2xs text-ink-3 hover:text-ink disabled:opacity-50"
      >
        <Download className="size-3" />
        {busy === 'png' ? 'در حال ساخت…' : 'PNG'}
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => doExport('svg')}
        className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-2xs text-ink-3 hover:text-ink disabled:opacity-50"
      >
        <Download className="size-3" />
        SVG
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => doExport('pdf')}
        className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-2xs text-ink-3 hover:text-ink disabled:opacity-50"
      >
        <Download className="size-3" />
        PDF
      </button>

      <span className="mx-1 h-4 w-px bg-hairline" />

      <button
        type="button"
        onClick={doExportDemo}
        className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-2xs text-ink-3 hover:text-ink"
      >
        <FileDown className="size-3" />
        دمو
      </button>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-2xs text-ink-3 hover:text-ink"
      >
        <FileUp className="size-3" />
        ورود دمو
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void doImport(f)
          // Reset so re-picking the same file fires again.
          e.target.value = ''
        }}
      />

      {error ? (
        <span className={cn('text-2xs text-warn')} role="alert">
          {error}
        </span>
      ) : null}
      <span className="sr-only">{toFaDigits(String(Math.round(anim.duration * 100) / 100))}</span>
    </div>
  )
}

export function ClearButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          onConfirm()
          setArmed(false)
          return
        }
        setArmed(true)
        // Disarm on its own: a destructive action that needs a second press
        // forever is just a button that never works.
        setTimeout(() => setArmed(false), 3000)
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-2xs',
        armed ? 'border-danger text-danger' : 'border-hairline text-ink-3 hover:text-ink',
      )}
    >
      <Trash2 className="size-3" />
      {armed ? 'مطمئن؟' : 'پاک‌کردن صحنه'}
    </button>
  )
}