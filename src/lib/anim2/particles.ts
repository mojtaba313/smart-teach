/**
 * A particle system with a hard cap.
 *
 * Particles are the one place where a scene can kill itself: 20 sparks × 60
 * frames × an unbounded lifetime is 60 000 DOM nodes. So the pool is fixed,
 * the oldest particle is recycled when it is full, and nothing is ever
 * allocated per particle per frame beyond the record itself.
 *
 * The pool lives outside React and the renderer subscribes to a version
 * counter, so spawning 200 particles does not re-render the scene tree.
 */

export type ParticleShape = 'dot' | 'spark' | 'star'

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds left. Zero means dead and available for reuse. */
  life: number
  maxLife: number
  size: number
  color: string
  shape: ParticleShape
  /** Radians; only used by `spark`. */
  angle: number
  spin: number
}

/** The cap from the brief. Beyond this, the oldest particle is recycled. */
export const MAX_PARTICLES = 500

/**
 * A burst of sparks when two charges get too close.
 *
 * `rand` is not used here: particles must replay identically when the viewer
 * scrubs back, so the spread comes from a seeded generator held by the caller
 * or from a simple angle sweep.
 */
export class ParticleSystem {
  private pool: Particle[] = []
  private cursor = 0
  /** Bumped whenever something changes, so React can compare a number. */
  version = 0

  get count(): number {
    return this.pool.length
  }

  get live(): Particle[] {
    return this.pool.filter((p) => p.life > 0)
  }

  /**
   * Spawn a burst.
   *
   * `budgetMs` is the time the frame has already used. If a frame is already
   * late, spawning is skipped rather than making it later — a scene that
   * stutters is worse than one that drops a few sparks.
   */
  spawn(
    at: { x: number; y: number },
    opts: {
      count: number
      color: string
      speed: number
      lifetime: number
      shape?: ParticleShape
      seed?: number
      budgetMs?: number
    },
  ): number {
    if (opts.budgetMs !== undefined && opts.budgetMs > 16) return 0

    const wanted = Math.max(0, Math.min(1000, Math.round(opts.count)))
    const shape = opts.shape ?? 'dot'
    let made = 0

    for (let i = 0; i < wanted; i += 1) {
      const p = this.take()
      // A deterministic spread: the same burst every time, no Math.random, so
      // scrubbing back and forth replays identically.
      const a = (i / Math.max(1, wanted)) * Math.PI * 2
      const jitter = 0.6 + 0.4 * fract(Math.sin((i + 1) * 12.9898 + (opts.seed ?? 0) * 78.233) * 43758.5453)
      const speed = opts.speed * jitter
      p.x = at.x
      p.y = at.y
      p.vx = Math.cos(a) * speed
      p.vy = Math.sin(a) * speed
      p.maxLife = opts.lifetime
      p.life = opts.lifetime
      p.size = shape === 'star' ? 5 : shape === 'spark' ? 3 : 4
      p.color = opts.color
      p.shape = shape
      p.angle = a
      p.spin = (i % 2 === 0 ? 1 : -1) * 6
      made += 1
    }
    this.version += 1
    return made
  }

  /**
   * Advance every particle by `dt` seconds and retire the dead ones.
   * Gravity is deliberately gentle — these are decorative marks, not physics.
   */
  step(dt: number, gravity = 0, drag = 0.98): void {
    // Clamped so a backgrounded tab does not teleport every particle across
    // the screen on return. The ceiling matches the clock's: clamping to a
    // single 60 Hz frame instead would run the whole simulation at half speed
    // on any machine that drops below 30 fps.
    const step = Math.min(0.25, Math.max(0, dt))
    for (const p of this.pool) {
      if (p.life <= 0) continue
      p.life -= step
      p.vy += gravity * step
      const damp = Math.pow(drag, step * 60)
      p.vx *= damp
      p.vy *= damp
      p.x += p.vx * step
      p.y += p.vy * step
      p.angle += p.spin * step
    }
    this.version += 1
  }

  /** Retire everything, e.g. on seek or on unmount. */
  clear(): void {
    for (const p of this.pool) p.life = 0
    this.pool = []
    this.cursor = 0
    this.version += 1
  }

  /** Recycle the oldest slot when the cap is reached. */
  private take(): Particle {
    if (this.pool.length < MAX_PARTICLES) {
      const p: Particle = {
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 4,
        color: '#fbbf24', shape: 'dot', angle: 0, spin: 0,
      }
      this.pool.push(p)
      return p
    }
    // Find the oldest live one; if everything is dead, round-robin.
    let oldestIndex = 0
    let oldestLife = Infinity
    for (let i = 0; i < this.pool.length; i += 1) {
      const p = this.pool[i]!
      if (p.life < oldestLife) {
        oldestLife = p.life
        oldestIndex = i
      }
    }
    this.cursor = (oldestIndex + 1) % this.pool.length
    return this.pool[this.cursor]!
  }
}

const fract = (n: number): number => n - Math.floor(n)

/** How alive a particle is, 0..1 — drives opacity and scale. */
export function particleFade(p: Particle): number {
  if (p.maxLife <= 0) return 0
  return Math.max(0, Math.min(1, p.life / p.maxLife))
}