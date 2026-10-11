import { describe, expect, it } from 'vitest'
import { Clock, prefersReducedMotion } from './clock'

describe('Clock', () => {
  it('clamps a seek to the duration', () => {
    const c = new Clock({ duration: 10 })
    c.seek(-5)
    expect(c.t).toBe(0)
    c.seek(99)
    expect(c.t).toBe(10)
  })

  it('publishes the time as its snapshot, with no wrapper object', () => {
    const c = new Clock({ duration: 4 })
    // useSyncExternalStore compares snapshots by value; returning an object
    // here would spin React forever.
    expect(typeof c.getSnapshot()).toBe('number')
    c.seek(2)
    expect(c.getSnapshot()).toBe(2)
  })

  it('notifies subscribers on a seek', () => {
    const c = new Clock({ duration: 4 })
    let hits = 0
    const off = c.subscribe(() => {
      hits += 1
    })
    c.seek(1)
    c.seek(2)
    off()
    c.seek(3)
    expect(hits).toBe(2)
  })

  it('does not emit for a seek that changes nothing', () => {
    const c = new Clock({ duration: 4 })
    let hits = 0
    c.subscribe(() => {
      hits += 1
    })
    c.seek(1)
    c.seek(1)
    expect(hits).toBe(1)
  })

  it('steps without playing', () => {
    const c = new Clock({ duration: 4 })
    c.step(0.5)
    expect(c.t).toBe(0.5)
    expect(c.playing).toBe(false)
  })

  it('restarts from the end', () => {
    const c = new Clock({ duration: 4 })
    c.seek(4)
    c.restart()
    expect(c.t).toBe(0)
  })

  it('reclamps when the document gets shorter', () => {
    const c = new Clock({ duration: 10 })
    c.seek(9)
    c.reconfigure({ duration: 3 })
    expect(c.t).toBe(3)
  })

  it('finds the next pause cue, and ignores ones in the past', () => {
    const c = new Clock({ duration: 10, pauses: [2, 5, 9], honourPauses: true })
    expect((c as unknown as { pauseCueAfter(t: number): number | null }).pauseCueAfter(0)).toBe(2)
    expect((c as unknown as { pauseCueAfter(t: number): number | null }).pauseCueAfter(2)).toBe(5)
    expect((c as unknown as { pauseCueAfter(t: number): number | null }).pauseCueAfter(9)).toBe(null)
  })

  it('never pauses on a cue at the very end, which is just the end', () => {
    const c = new Clock({ duration: 4, pauses: [4], honourPauses: true })
    expect((c as unknown as { pauseCueAfter(t: number): number | null }).pauseCueAfter(0)).toBe(null)
  })

  it('does not throw without requestAnimationFrame', () => {
    const c = new Clock({ duration: 2 })
    expect(() => c.play()).not.toThrow()
    expect(() => c.pause()).not.toThrow()
    c.dispose()
  })

  it('survives having no media query support', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean')
  })
})