/**
 * Colour handling for the renderer.
 *
 * Colours may be written as hex, `hsl()`, `hsla()` or an SVG keyword, and may
 * be adjusted after the fact by the node's `hueRotate` and `brightness`. Doing
 * the adjustment here — on a parsed colour — rather than by stacking SVG filter
 * primitives means the result survives export to a file that has no CSS engine,
 * which is the case for the PNG and PDF paths.
 */

/** HSV in 0..360 / 0..1 / 0..1, plus alpha in 0..1. */
export type Hsv = { h: number; s: number; v: number; a: number }

const NAMED: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ef4444',
  blue: '#2563eb',
  green: '#22c55e',
  yellow: '#facc15',
  orange: '#f97316',
  purple: '#a855f7',
  gray: '#6b7280',
  grey: '#6b7280',
}

/** Parse a colour string into HSV, or null when it is not one we understand. */
export function parseColor(input: string): Hsv | null {
  const raw = input.trim()
  const lower = raw.toLowerCase()
  const named = NAMED[lower]
  const text = named ?? raw

  if (text.startsWith('#')) {
    const hex = text.slice(1)
    const expand = (s: string): number => parseInt(s.length === 1 ? s + s : s, 16)
    if (hex.length === 3 || hex.length === 4) {
      // Hex carries no saturation or value, so they are derived rather than
      // invented — `rgbToHsv` returns the whole triple from the channels.
      return {
        ...rgbToHsv(expand(hex[0]), expand(hex[1]), expand(hex[2])),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        ...rgbToHsv(expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6))),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      }
    }
    return null
  }

  const fn = /^hsla?\(([^)]*)\)$/.exec(lower)
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean)
    if (parts.length < 3) return null
    const h = parseAngle(parts[0])
    const s = clamp01(parsePercent(parts[1]))
    const v = clamp01(parsePercent(parts[2]))
    const a = parts.length > 3 ? clamp01(parsePercent(parts[3])) : 1
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(v)) return null
    return { h, s, v, a }
  }

  return null
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

function parseAngle(s: string): number {
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return NaN
  return s.endsWith('grad') ? n * 0.9 : n
}

function parsePercent(s: string): number {
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return NaN
  return s.endsWith('%') ? n / 100 : n
}

const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  if (d === 0) return { h: 0, s: 0, v: max }
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: ((h * 60) % 360 + 360) % 360, s: d === 0 ? 0 : d / max, v: max }
}

export const hsvToRgb = ({ h, s, v }: Hsv): { r: number; g: number; b: number } => {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const seg = Math.floor(h / 60) % 6
  const table: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = table[seg] ?? table[0]
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

/** Hex, including alpha, so the value survives a file with no CSS engine. */
export function toHex(c: Hsv): string {
  const { r, g, b } = hsvToRgb(c)
  const base = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  if (c.a >= 1) return base
  return `${base}${Math.round(clamp01(c.a) * 255).toString(16).padStart(2, '0')}`
}

/**
 * Apply a node's adjustments. Both are multiplicative or additive in the HSV
 * space, which is what "tint by hue" and "make it darker" mean; doing it in RGB
 * would shift saturation as a side effect and quietly break a palette.
 *
 * An unparseable colour is returned untouched — a `var(--x)` reference is
 * perfectly valid and only resolvable in the browser.
 */
export function adjustColor(
  input: string,
  hueRotate: number | undefined,
  brightness: number | undefined,
): string {
  if ((hueRotate === undefined || hueRotate === 0) && (brightness === undefined || brightness === 1)) {
    return input
  }
  const parsed = parseColor(input)
  if (!parsed) return input
  const out: Hsv = {
    h: hueRotate ? (((parsed.h + hueRotate) % 360) + 360) % 360 : parsed.h,
    s: parsed.s,
    v: clamp01(parsed.v * (brightness ?? 1)),
    a: parsed.a,
  }
  return toHex(out)
}