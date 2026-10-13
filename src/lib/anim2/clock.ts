/**
 * The playback clock, deliberately outside React.
 *
 * In v1 `t` was a `useState` in the studio, so every single frame re-rendered
 * the entire studio: the scene, the timeline, all three inspector panels, the
 * undo history and the save indicator. The clock here is a plain object with
 * a listener set, and only the canvas subscribes to it — via
 * `useSyncExternalStore` — so a frame touches one subtree and nothing else.
 */

export type ClockListener = () => void

export type ClockOptions = {
  duration: number
  loop?: boolean
  speed?: number
  /**
   * Playable slices, sorted and normalised by the clock. Empty means the whole
   * timeline. A lesson that must stop at a question uses a segment rather than
   * a pause cue, because a segment can be skipped to on demand while a cue
   * only ever stops.
   */
  segments?: { from: number; to: number }[]
  /** Reverse at each segment's end and go again. */
  pingPong?: boolean
  /** Begin here rather than 0. */
  startAt?: number
  /** Stop here rather than at `duration`. */
  stopAt?: number
  /** Cues with `pause` stop presenter playback until Space is pressed. */
  pauses?: number[]
  /** Presenter mode honours pause cues; the viewer does not. */
  honourPauses?: boolean
}

export class Clock {
  t = 0
  playing = false
  speed: number

  duration: number
  loop: boolean
  pauses: number[]
  honourPauses: boolean
  /** Set when the clock stopped on a cue rather than at the end. */
  stoppedAtCue: number | null = null
  /** Normalised playable slices, ascending. Empty means the whole timeline. */
  segments: { from: number; to: number }[] = []
  /** Direction of travel; -1 while a ping-pong is on its way back. */
  direction: 1 | -1 = 1
  pingPong = false
  startAt = 0
  stopAt: number | null = null

  private listeners = new Set<ClockListener>()
  private frame: number | null = null
  private last = 0

  constructor(options: ClockOptions) {
    this.duration = Math.max(0.001, options.duration)
    this.loop = options.loop === true
    this.pauses = options.pauses ?? []
    this.honourPauses = options.honourPauses === true
    this.speed = options.speed && options.speed > 0 ? options.speed : 1
    this.applySegments(options)
  }

  /**
   * Normalise the declared segments. Overlaps are merged and backwards slices
   * swapped, because a hand-edited segment is the most likely source of a clock
   * that gets stuck at a boundary.
   */
  private applySegments(options: ClockOptions): void {
    const raw = (options.segments ?? [])
      .map((s) => ({ from: Math.max(0, Math.min(this.duration, s.from)), to: Math.max(0, Math.min(this.duration, s.to)) }))
      .map((s) => (s.to < s.from ? { from: s.to, to: s.from } : s))
      .filter((s) => s.to - s.from > 1e-6)
      .sort((a, b) => a.from - b.from)
    const merged: { from: number; to: number }[] = []
    for (const s of raw) {
      const last = merged[merged.length - 1]
      if (last && s.from <= last.to + 1e-6) last.to = Math.max(last.to, s.to)
      else merged.push({ ...s })
    }
    this.segments = merged
    this.pingPong = options.pingPong === true
    this.startAt = Math.max(0, Math.min(this.end, options.startAt ?? 0))
    this.stopAt = options.stopAt === undefined ? null : Math.max(0, Math.min(this.duration, options.stopAt))
  }

  subscribe = (listener: ClockListener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * The snapshot *is* the time. `useSyncExternalStore` compares snapshots by
   * value, and a number is a value — no wrapper object, no revision counter,
   * and no ref read during render anywhere in the tree.
   */
  getSnapshot = (): number => this.t

  private emit(): void {
    for (const l of this.listeners) l()
  }

  /** The furthest point playback may reach. */
  get end(): number {
    const bySegments = this.segments.length > 0 ? this.segments[this.segments.length - 1].to : this.duration
    return Math.min(bySegments, this.stopAt ?? this.duration)
  }

  /**
   * The next boundary at or after `from`, moving in the current direction.
   * Returns null when there is no boundary, meaning "free running".
   */
  private boundary(from: number): number | null {
    if (this.segments.length === 0) return null
    if (this.direction === 1) {
      for (const s of this.segments) if (s.to > from + 1e-9) return s.to
      return null
    }
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.segments[i].from < from - 1e-9) return this.segments[i].from
    }
    return null
  }

  /** The containing slice, or the whole timeline when there are none. */
  private spanAt(t: number): { from: number; to: number } {
    if (this.segments.length === 0) return { from: 0, to: this.duration }
    for (const s of this.segments) if (t >= s.from - 1e-9 && t <= s.to + 1e-9) return s
    // Outside every slice — land on the nearest edge rather than the middle of
    // something unrelated.
    return this.direction === 1 ? this.segments[0] : this.segments[this.segments.length - 1]
  }

  /** Jump to a time, clamped, and restart the step if needed. */
  seek(t: number): void {
    const clamped = Math.min(this.end, Math.max(0, t))
    if (Math.abs(clamped - this.t) < 1e-9) return
    this.stoppedAtCue = null
    this.t = clamped
    this.last = performance.now()
    this.emit()
  }

  play(): void {
    if (this.playing) return
    // Resume from the segment the clock is standing in, not from zero.
    if (this.t >= this.end - 1e-6) {
      const first = this.spanAt(this.startAt)
      this.t = this.direction === 1 ? first.from : first.to
    }
    this.stoppedAtCue = null
    this.playing = true
    this.last = performance.now()
    this.startLoop()
    this.emit()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.stopLoop()
    this.emit()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  restart(): void {
    this.t = 0
    this.last = performance.now()
    this.emit()
  }

  step(delta: number): void {
    this.pause()
    this.seek(this.t + delta)
  }

  /** Called when the animation document itself changes. */
  reconfigure(options: ClockOptions): void {
    this.duration = Math.max(0.001, options.duration)
    this.loop = options.loop === true
    this.pauses = options.pauses ?? this.pauses
    this.honourPauses = options.honourPauses ?? this.honourPauses
    if (options.speed !== undefined && options.speed > 0) this.speed = options.speed
    this.applySegments(options)
    if (this.t > this.end) this.t = this.end
    this.emit()
  }

  private startLoop(): void {
    if (this.frame !== null) return
    if (typeof requestAnimationFrame !== 'function') return
    this.last = performance.now()
    const step = (now: number): void => {
      if (!this.playing) return
      const dt = Math.min(0.25, (now - this.last) / 1000) * this.speed
      this.last = now
      let next = this.t + dt
      const cue = this.honourPauses ? this.pauseCueAfter(this.t) : null
      if (cue !== null && next >= cue) {
        // A lesson asks its question here; Space carries on.
        next = cue
        this.playing = false
        this.stoppedAtCue = cue
      } else {
        const edge = this.direction === 1 ? next >= this.end : next <= 0
        const segment = this.boundary(this.t)
        if (segment !== null) {
          if (next >= segment) {
            next = segment
            if (this.pingPong) this.direction = -1
            else if (this.loop) next = this.spanAt(next).from
            else {
              this.playing = false
            }
          } else if (next < this.spanAt(this.t).from) {
            next = this.spanAt(this.t).from
            this.playing = false
          }
        } else if (edge) {
          if (this.pingPong) {
            next = this.end
            this.direction = -1
          } else if (this.loop) {
            next = this.duration > 0 ? next % this.duration : 0
          } else {
            next = this.end
            this.playing = false
          }
        }
      }
      this.t = next
      this.emit()
      if (!this.playing) {
        this.frame = null
        return
      }
      this.frame = requestAnimationFrame(step)
    }
    this.frame = requestAnimationFrame(step)
  }

  private stopLoop(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
  }

  dispose(): void {
    this.stopLoop()
    this.listeners.clear()
  }

  /** The next pause cue strictly after `from`, if any. */
  private pauseCueAfter(from: number): number | null {
    for (const cue of this.pauses) {
      if (cue > from + 1e-6 && cue < this.duration - 1e-6) return cue
    }
    return null
  }
}

/** Whether the viewer has asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}