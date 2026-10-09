import { useEffect, useRef, useState } from 'react'

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