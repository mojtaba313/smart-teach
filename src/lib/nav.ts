'use client'
import { useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * The two router hooks the app actually uses, behind one helper.
 *
 * Next's `useRouter().push` cannot do `replace` on a search-param change the
 * way react-router's `setParams` did, so that one case is spelled out here
 * rather than at every call site.
 */
export function useNav() {
  const router = useRouter()
  const params = useSearchParams()
  const go = useCallback((path: string) => router.push(path), [router])
  const replace = useCallback((path: string) => router.replace(path), [router])
  /** replace the query string without adding a history entry */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
      const qs = next.toString()
      router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false })
    },
    [params, router],
  )
  return { go, replace, setParam, params }
}
