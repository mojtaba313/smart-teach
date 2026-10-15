'use client'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { useSyncState } from '../lib/sync'
import { refreshStores } from '../lib/store'
import { toFaDigits } from '../lib/utils'
import { Badge, Button } from './ui/primitives'
import { toast } from './ui/overlay'

/**
 * Whether the database is reachable.
 *
 * This used to report how many edits were queued in `localStorage` and offer to
 * hand the browser's copy up to the server. With one store there is no queue
 * and no second copy, so all that is left to say is "it worked" or "it did
 * not" — and a retry, because a transient failure should be one click to
 * recover rather than a reload.
 */
export function SyncBadge() {
  const state = useSyncState()

  if (state === 'online') {
    return (
      <Badge tone="ok" className="gap-1">
        <Cloud className="size-3" />
        پایگاه داده
      </Badge>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="danger" className="gap-1">
        <CloudOff className="size-3" />
        آفلاین — تغییراتی ذخیره نشده
      </Badge>
      <Button
        size="xs"
        variant="subtle"
        icon={RefreshCw}
        onClick={async () => {
          await refreshStores()
          toast('تلاش دوباره شد', 'ok', {
            detail: `${toFaDigits(new Date().toLocaleTimeString('fa-IR'))}`,
          })
        }}
      >
        تلاش دوباره
      </Button>
    </span>
  )
}