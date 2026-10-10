'use client'
import { useEffect } from 'react'
import { syncOnBoot } from '../lib/sync'
import { refreshStores } from '../lib/store'

/**
 * Reconcile with PostgreSQL once, on the client.
 *
 * It has to live in a client component: the stores are `useSyncExternalStore`
 * hooks, and the cache is in `localStorage`. Running it in a server component
 * would both fail and defeat the point — the point is to merge the browser's
 * old cache with the database before anyone edits anything.
 */
export function BootSync() {
  useEffect(() => {
    void syncOnBoot().then(refreshStores)
  }, [])
  return null
}
