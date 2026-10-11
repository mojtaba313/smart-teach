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

  private listeners = new Set<ClockListener>()
  private frame: number | null = null
  private last = 0

  constructor(options: ClockOptions) {
    this.duration = Math.max(0.001, options.duration)
    this.loop = options.loop === true
    this.pauses = options.pauses ?? []
    this.honourPauses = options.honourPauses === true
    this.speed = options.speed && options.speed > 0 ? options.speed : 1
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

  /** Jump to a time, clamped, and restart the step if needed. */
  seek(t: number): void {
    const clamped = Math.min(this.duration, Math.max(0, t))
    if (Math.abs(clamped - this.t) < 1e-9) return
    this.stoppedAtCue = null
    this.t = clamped
    this.last = performance.now()
    this.emit()
  }

  play(): void {
    if (this.playing) return
    if (this.t >= this.duration - 1e-6) this.t = 0
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
    if (this.t > this.duration) this.t = this.duration
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
      } else if (next >= this.duration) {
        if (this.loop) {
          next = this.duration > 0 ? next % this.duration : 0
        } else {
          next = this.duration
          this.playing = false
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