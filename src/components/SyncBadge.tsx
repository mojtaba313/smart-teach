'use client'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { pendingCount, pushLocalToServer, useSyncState } from '../lib/sync'
import { usePresentations } from '../lib/store'
import { toFaDigits } from '../lib/utils'
import { Button, Badge } from './ui/primitives'
import { toast } from './ui/overlay'

/**
 * Where the data came from, and what is still waiting to go up.
 *
 * "PostgreSQL is the source of truth" is only true if people can see it: this
 * says whether the last load came from the database, whether edits are queued
 * because it could not be reached, and offers the one-time hand-over.
 */
export function SyncBadge() {
  const state = useSyncState()
  const library = usePresentations()
  const pending = pendingCount()

  if (state === 'online' && pending === 0) {
    return (
      <Badge tone="ok" className="gap-1">
        <Cloud className="size-3" />
        پایگاه داده
      </Badge>
    )
  }

  if (state === 'offline' && pending > 0) {
    return (
      <Badge tone="danger" className="gap-1">
        <CloudOff className="size-3" />
        آفلاین · {toFaDigits(pending)} در صف
      </Badge>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="accent" className="gap-1">
        <CloudOff className="size-3" />
        آفلاین — فقط همین مرورگر
      </Badge>
      {library.length > 0 && (
        <Button
          size="xs"
          variant="subtle"
          icon={RefreshCw}
          onClick={async () => {
            const r = await pushLocalToServer()
            toast('کتابخانه به پایگاه داده رفت ✓', 'ok', {
              detail: `${toFaDigits(r.presentations)} ارائه · ${toFaDigits(r.questions)} سؤال`,
            })
          }}
        >
          بفرست به پایگاه داده
        </Button>
      )}
    </span>
  )
}
