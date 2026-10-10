'use client'
import { useMounted } from '../lib/useInView'

/**
 * Render children only in the browser.
 *
 * This app reads its data from a cache and a database on the client, so its
 * first client render is never equal to what the server produced. Rendering
 * the screens client-only is honest about that — a hydration mismatch is
 * React telling you the two trees disagree, and here they genuinely do.
 */
export function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const mounted = useMounted()
  return mounted ? <>{children}</> : <>{fallback}</>
}
