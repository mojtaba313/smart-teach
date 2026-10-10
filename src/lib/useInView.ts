import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * Is this element on screen? Powers "don't animate what nobody can see":
 * a deck with thirty animations should not run thirty requestAnimationFrame
 * loops while the teacher is looking at slide two.
 *
 * `margin` starts reporting visible slightly before the element actually
 * arrives, so playback is already running by the time it is in view.
 */
export function useInView<T extends HTMLElement>(margin = '160px') {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // No observer (old browser, test env without layout) → assume visible.
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting)
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margin])

  return [ref, inView] as const
}
/**
 * True only after the first client render.
 *
 * Overlays portal into `document.body`, which does not exist while Next
 * prerenders a page — rendering them only on the client is also what keeps
 * the server HTML and the first client render identical.
 */
export function useMounted() {
  // `useSyncExternalStore` is the sanctioned way to branch on "are we on the
  // client" without a setState-in-effect cascade.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  )
  return mounted
}
