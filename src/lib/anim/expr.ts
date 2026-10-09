/**
 * A tiny, safe expression language for the animation studio.
 *
 * Everything is compiled to a closure tree — no `eval`, no `Function`, so a
 * user-supplied formula can never reach the page's globals.
 *
 *   Variables : t (time in seconds)
 *   Operators : + - * / % ^ and the Persian-friendly × ÷ −
 *   Constants : pi, e, tau
 *   Functions : sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log
 *               floor ceil round sign atan2 min max pow mod hypot
 */

export type ExprFn = (t: number) => number

export type CompileResult =
  | { ok: true; fn: ExprFn }
  | { ok: false; error: string; at: number }

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: (x: number, base = 10) => Math.log(x) / Math.log(base),
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mod: (a: number, b: number) => a % b,
  hypot: Math.hypot,
}

const CONSTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
}

const FA_DIGIT = (c: string): string => {
  const code = c.charCodeAt(0)
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0)
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
  return c
}

type Tok =
  | { t: 'num'; v: number; at: number }
  | { t: 'id'; v: string; at: number }
  | { t: 'op'; v: string; at: number }
  | { t: 'punc'; v: string; at: number }

function tokenize(src: string): { toks: Tok[]; error?: string } {
  const toks: Tok[] = []
  let i = 0
  const s = src
  while (i < s.length) {
    const raw = s[i]
    if (raw === ' ' || raw === '\t' || raw === '\n' || raw === '،') {
      i += 1
      continue
    }
    const ch = FA_DIGIT(raw)
    if (ch >= '0' && ch <= '9') {
      let j = i
      let seenDot = false
      while (j < s.length) {
        const c = FA_DIGIT(s[j])
        if (c >= '0' && c <= '9') j += 1
        else if ((c === '.' || c === '٫') && !seenDot) {
          seenDot = true
          j += 1
        } else break
      }
      const text = [...s.slice(i, j)].map(FA_DIGIT).join('').replace('٫', '.')
      const v = Number.parseFloat(text)
      if (!Number.isFinite(v)) return { toks, error: `عدد نامعتبر در موقعیت ${i}` }
      toks.push({ t: 'num', v, at: i })
      i = j
      continue
    }
    if (/[a-zA-Z_π]/i.test(raw) || ch === 'π') {
      let j = i
      while (j < s.length && /[a-zA-Z0-9_π]/i.test(s[j])) j += 1
      toks.push({ t: 'id', v: s.slice(i, j).toLowerCase(), at: i })
      i = j
      continue
    }
    if ('+-*/%^'.includes(raw)) {
      toks.push({ t: 'op', v: raw, at: i })
      i += 1
      continue
    }
    if (raw === '×') {
      toks.push({ t: 'op', v: '*', at: i })
      i += 1
      continue
    }
    if (raw === '÷' || raw === '٪') {
      toks.push({ t: 'op', v: '/', at: i })
      i += 1
      continue
    }
    if (raw === '−' || raw === '–') {
      toks.push({ t: 'op', v: '-', at: i })
      i += 1
      continue
    }
    if ('()'.includes(raw)) {
      toks.push({ t: 'punc', v: raw, at: i })
      i += 1
      continue
    }
    if (raw === ',') {
      toks.push({ t: 'punc', v: ',', at: i })
      i += 1
      continue
    }
    return { toks, error: `نویسهٔ ناشناخته «${raw}» در موقعیت ${i}` }
  }
  return { toks }
}

type Node =
  | { k: 'const'; v: number }
  | { k: 'var' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }

class Parser {
  private i = 0
  private toks: Tok[]
  private src: string

  constructor(toks: Tok[], src: string) {
    this.toks = toks
    this.src = src
  }

  private peek(): Tok | undefined {
    return this.toks[this.i]
  }

  private eat(v: string): boolean {
    const t = this.peek()
    if (t && ((t.t === 'op' || t.t === 'punc') && t.v === v)) {
      this.i += 1
      return true
    }
    return false
  }

  parse(): Node | string {
    const node = this.sum()
    if (typeof node === 'string') return node
    if (this.i < this.toks.length) {
      const t = this.peek()!
      return `موقعیت ${t.at}: «${this.src.slice(t.at, t.at + 6)}»`
    }
    return node
  }

  private sum(): Node | string {
    let left = this.product()
    if (typeof left === 'string') return left
    for (;;) {
      const t = this.peek()
      if (!t || t.t !== 'op' || (t.v !== '+' && t.v !== '-')) return left
      this.i += 1
      const right = this.product()
      if (typeof right === 'string') return right
      left = { k: 'bin', op: t.v, a: left, b: right }
    }
  }

  private product(): Node | string {
    let left = this.unary()
    if (typeof left === 'string') return left
    for (;;) {
      const t = this.peek()
      if (!t || t.t !== 'op' || (t.v !== '*' && t.v !== '/' && t.v !== '%')) return left
      this.i += 1
      const right = this.unary()
      if (typeof right === 'string') return right
      left = { k: 'bin', op: t.v, a: left, b: right }
    }
  }

  private unary(): Node | string {
    const t = this.peek()
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.i += 1
      const inner = this.unary()
      if (typeof inner === 'string') return inner
      return t.v === '-' ? { k: 'neg', a: inner } : inner
    }
    return this.power()
  }

  private power(): Node | string {
    const base = this.primary()
    if (typeof base === 'string') return base
    if (this.eat('^')) {
      const exp = this.unary()
      if (typeof exp === 'string') return exp
      return { k: 'bin', op: '^', a: base, b: exp }
    }
    return base
  }

  private primary(): Node | string {
    const t = this.peek()
    if (!t) return 'فرمول ناتمام است'
    if (t.t === 'num') {
      this.i += 1
      return { k: 'const', v: t.v }
    }
    if (t.t === 'punc' && t.v === '(') {
      this.i += 1
      const inner = this.sum()
      if (typeof inner === 'string') return inner
      if (!this.eat(')')) return `پرانتز بسته نشده (موقعیت ${t.at})`
      return inner
    }
    if (t.t === 'id') {
      this.i += 1
      if (this.peek() && this.peek()!.t === 'punc' && this.peek()!.v === '(') {
        const name = t.v
        if (!FUNCS[name]) return `تابع ناشناخته «${name}»`
        this.i += 1
        const args: Node[] = []
        if (!this.eat(')')) {
          for (;;) {
            const arg = this.sum()
            if (typeof arg === 'string') return arg
            args.push(arg)
            if (this.eat(',')) continue
            if (this.eat(')')) break
            return `پرانتز تابع «${name}» بسته نشده`
          }
        }
        return { k: 'call', name, args }
      }
      if (t.v === 't' || t.v === 'time' || t.v === 'زمان') return { k: 'var' }
      if (t.v in CONSTS) return { k: 'const', v: CONSTS[t.v] }
      return `نام ناشناخته «${t.v}» — فقط t و توابع ریاضی مجازند`
    }
    return `نشانهٔ غیرمنتظره در موقعیت ${t.at}`
  }
}

function build(node: Node): ExprFn {
  switch (node.k) {
    case 'const':
      return () => node.v
    case 'var':
      return (t: number) => t
    case 'neg': {
      const a = build(node.a)
      return (t) => -a(t)
    }
    case 'bin': {
      const a = build(node.a)
      const b = build(node.b)
      const op = node.op
      if (op === '+') return (t) => a(t) + b(t)
      if (op === '-') return (t) => a(t) - b(t)
      if (op === '*') return (t) => a(t) * b(t)
      if (op === '/') return (t) => a(t) / b(t)
      if (op === '%') return (t) => a(t) % b(t)
      return (t) => Math.pow(a(t), b(t))
    }
    case 'call': {
      const fn = FUNCS[node.name]
      const args = node.args.map(build)
      return (t) => fn(...args.map((f) => f(t)))
    }
  }
}

const cache = new Map<string, ExprFn | null>()

/** Compile with memoisation. Returns `null` for an empty/invalid formula. */
export function compile(src: string): ExprFn | null {
  const key = src.trim()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null
  const { toks, error } = tokenize(key)
  const parsed = error ? null : new Parser(toks, key).parse()
  const fn: ExprFn | null = parsed === null ? null : typeof parsed === 'string' ? null : build(parsed)
  cache.set(key, fn)
  return fn
}

/** Validate without throwing — used for live editor feedback. */
export function check(src: string): CompileResult {
  const key = src.trim()
  if (!key) return { ok: false, error: 'خالی است', at: 0 }
  const { toks, error } = tokenize(key)
  if (error) return { ok: false, error, at: 0 }
  const parsed = new Parser(toks, key).parse()
  if (typeof parsed === 'string') {
    const m = parsed.match(/(\d+)/)
    return { ok: false, error: parsed, at: m ? Number(m[1]) : 0 }
  }
  return { ok: true, fn: build(parsed) }
}

/** Evaluate defensively — non-finite results collapse to `fallback`. */
export function evalExpr(src: string, t: number, fallback = 0): number {
  const fn = compile(src)
  if (!fn) return fallback
  let v: number
  try {
    v = fn(t)
  } catch {
    return fallback
  }
  return Number.isFinite(v) ? v : fallback
}

export const EXPR_FUNCS = Object.keys(FUNCS)
/** Suggested formulas shown as one-tap chips in the studio. */
export const EXPR_EXAMPLES: { label: string; expr: string }[] = [
  { label: 'مکان با شتاب ثابت', expr: 'v0*t + 0.5*a*t^2' },
  { label: 'سرعت با شتاب ثابت', expr: 'v0 + a*t' },
  { label: 'پرتابه: ارتفاع', expr: 'v0y*t - 0.5*9.8*t^2' },
  { label: 'نوسان ساده', expr: 'A*sin(w*t)' },
  { label: 'پیکان افقی', expr: 'v0*t' },
  { label: 'بازگشت به مبدأ', expr: 'A*sin(w*t)^2' },
]
