'use client'

import { useCallback, useRef, useState } from 'react'
import { ImageUp, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Upload an image and hand back its URL.
 *
 * The URL field stays as the primary path: a teacher with an image already on
 * a CDN should never be forced through an upload, and most of the images in
 * existing decks are URLs. This sits *beside* the field rather than replacing
 * it.
 *
 * Pasted image data is handled here too, because pasting is what a user
 * actually does when they have a screenshot on their clipboard — and a
 * `data:` URL pasted into a deck is a megabyte of base64 that gets stored,
 * migrated and sent over the wire on every read.
 */

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

export function ImageUpload({
  onUploaded,
  disabled,
}: {
  onUploaded: (url: string) => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const send = useCallback(
    async (file: File) => {
      setError(null)
      if (file.size > MAX_BYTES) {
        setError(`حجم فایل بیش از ${Math.round(MAX_BYTES / 1024 / 1024)} مگابایت است.`)
        return
      }
      setBusy(true)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: form })
        const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
        if (!res.ok || !json?.url) {
          setError(json?.error ?? 'بارگذاری ناکام ماند.')
          return
        }
        onUploaded(json.url)
      } catch {
        setError('ارتباط با سرور برقرار نشد.')
      } finally {
        setBusy(false)
      }
    },
    [onUploaded],
  )

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          onPaste={(e) => {
            // Paste a screenshot straight into the drop area; ignore text.
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
            if (file) {
              e.preventDefault()
              void send(file)
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
            if (file) {
              e.preventDefault()
              void send(file)
            }
          }}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2 text-2xs text-ink-3',
            'hover:border-brand/50 hover:text-brand disabled:opacity-50',
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />}
          {busy ? 'در حال بارگذاری…' : 'بارگذاری تصویر'}
        </button>
        <span className="text-2xs text-ink-3">یا بکشید و رها کنید</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void send(file)
            // Reset so re-picking the same file fires a change event again.
            e.target.value = ''
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-2xs text-warn">
          {error}
        </p>
      ) : null}
    </div>
  )
}
