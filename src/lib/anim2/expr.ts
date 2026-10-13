/**
 * The expression language for animation v2.
 *
 * Design notes, because the constraints here are not obvious:
 *
 * - **No `eval`, no `new Function`.** Everything compiles to a tree of
 *   closures. That keeps teacher-authored text from becoming arbitrary code,
 *   and it makes evaluation fast enough to run per-node per-frame.
 * - **No allocation per call.** Each node compiles to a unary closure that
 *   closes over its children, so a full frame of a 200-node scene allocates
 *   nothing. This is what "arity-specialised" means here.
 * - **`d()` is symbolic.** Differentiating the AST (rather than sampling)
 *   gives exact derivatives for the overwhelmingly common cases
 *   (`d(4*t - 2*t*t)` is `4 - 4*t`, not a finite difference of it).
 *   References are the exception: they fall back to a central difference
 *   because the engine, not this module, knows what they mean.
 * - **Scopes are explicit.** The same source compiles differently depending
 *   on which names and references exist, so the scope is part of the cache
 *   key — never a global that a later compile can invalidate.
 */

/* ------------------------------------------------------------------ *
 *  Errors
 * ------------------------------------------------------------------ */

export class ExprError extends Error {
  /** 1-based character position in the source. */
  readonly pos: number
  readonly code: string

  constructor(message: string, pos: number, code = 'syntax') {
    super(`${message} — ناحیهٔ ${fa(pos)}`)
    this.name = 'ExprError'
    this.pos = pos
    this.code = code
  }
}

/** Persian-friendly rendering of a 1-based position. */
function fa(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

function err(message: string, pos: number, code = 'syntax'): never {
  throw new ExprError(message, pos, code)
}

/* ------------------------------------------------------------------ *
 *  Scope
 * ------------------------------------------------------------------ */

/** Everything an expression can read at evaluation time. */
export type EvalEnv = {
  /** The scene clock, in seconds. */
  t: number
  /** Local time: `t - node.time.start`. */
  lt: number
  /** The axis variable, inside a plot or an axes frame. */
  x: number
  /** The curve parameter, inside a parametric plot. */
  u: number
  /** The animation's total duration, so `lt / duration` reads naturally. */
  duration: number
  /** Named values: params, plus anything else the engine binds. */
  v: Record<string, number>
  /**
   * Resolve `@id.prop` at an explicit time. The engine must accept a time
   * rather than reading a global, so that `d()` can ask for `t ± h`.
   */
  refAt?: (path: string, at: number) => number
  /** Resolve `@plotId.at(x)`. */
  plotAt?: (id: string, x: number) => number
}

export type CompiledExpr = {
  (env: EvalEnv): number
  /** The source it was compiled from. */
  readonly source: string
  /** Free names it reads (`t`, `x`, params, …). */
  readonly deps: readonly string[]
  /** `@` references it reads. */
  readonly refs: readonly string[]
  /** False only when the value provably cannot change with time. */
  readonly timeDependent: boolean
}

/** What is legal to write in a given position. */
export type Scope = {
  /** Plain names: `t`, `lt`, `x`, `u`, parameter names. */
  vars: ReadonlySet<string>
  /**
   * Ids that may be referenced with `@`. Omit to forbid references entirely;
   * supply an empty set to allow `@id.…` without validating the id.
   */
  refIds?: ReadonlySet<string>
}

/** Names available everywhere, without declaring anything. */
export const BASE_VARS: ReadonlySet<string> = new Set(['t', 'lt', 'x', 'u', 'duration'])

/* ------------------------------------------------------------------ *
 *  Lexer
 * ------------------------------------------------------------------ */

type TokKind = 'num' | 'ident' | 'op' | 'punc' | 'ref' | 'eof'
type Tok = { kind: TokKind; text: string; value: number; pos: number }

/** Persian and Arabic-Indic digits, so a teacher can type numbers natively. */
const isDigit = (c: string): boolean =>
  (c >= '0' && c <= '9') ||
  (c >= '۰' && c <= '۹') ||
  (c >= '٠' && c <= '٩')

function digitValue(c: string): number {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= '۰' && c <= '۹') return c.charCodeAt(0) - 0x06f0
  return c.charCodeAt(0) - 0x0660
}

/**
 * Identifiers are Unicode letters, so a parameter can be named `شتاب`.
 * Case matters: `A` and `a` are different parameters.
 */
function isIdentStart(c: string): boolean {
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    c === '_' ||
    (c >= 'ؠ' && c <= 'ۿ') /* Arabic */ ||
    (c >= 'Ͱ' && c <= 'Ͽ') /* Greek */ ||
    (c >= 'Ѐ' && c <= 'ӿ') /* Cyrillic */ ||
    (c >= '一' && c <= '鿿') /* CJK */
  )
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c)
}

const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '!']

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1
      continue
    }
    const pos = i + 1

    // @ref, optionally `@id@anchor` to address a named attachment point.
    if (c === '@') {
      i += 1
      const start = i
      while (i < n && isIdentPart(src[i])) i += 1
      if (i === start) err('بعد از @ باید نام یک جسم بیاید', pos, 'ref')
      if (src[i] === '@') {
        const anchorStart = i + 1
        let j = anchorStart
        while (j < n && isIdentPart(src[j])) j += 1
        if (j === anchorStart) err('بعد از @ دوم باید نام لنگر بیاید', pos, 'ref')
        out.push({
          kind: 'ref',
          text: `${src.slice(start, i)}@${src.slice(anchorStart, j)}`,
          value: 0,
          pos,
        })
        i = j
        continue
      }
      out.push({ kind: 'ref', text: src.slice(start, i), value: 0, pos })
      continue
    }

    // number, with optional exponent
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i
      while (i < n && isDigit(src[i])) i += 1
      if (src[i] === '.') {
        i += 1
        while (i < n && isDigit(src[i])) i += 1
      }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = i
        i += 1
        if (src[i] === '+' || src[i] === '-') i += 1
        if (isDigit(src[i] ?? '')) {
          while (i < n && isDigit(src[i])) i += 1
        } else {
          i = save // `2e` is `2 * e`, not a broken exponent
        }
      }
      const text = src.slice(start, i)
      const normalised = text.replace(/[۰-۹٠-٩]/g, (d) => String(digitValue(d)))
      const value = Number(normalised)
      if (!Number.isFinite(value)) err(`عدد نامعتبر: «${text}»`, pos, 'number')
      out.push({ kind: 'num', text, value, pos })
      continue
    }

    // identifier
    if (isIdentStart(c)) {
      const start = i
      while (i < n && isIdentPart(src[i])) i += 1
      out.push({ kind: 'ident', text: src.slice(start, i), value: 0, pos })
      continue
    }

    // punctuation
    if (c === '(' || c === ')' || c === ',' || c === '.') {
      i += 1
      out.push({ kind: 'punc', text: c, value: 0, pos })
      continue
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i))
    if (op) {
      i += op.length
      out.push({ kind: 'op', text: op, value: 0, pos })
      continue
    }

    err(`نویسهٔ ناشناخته «${c}»`, pos, 'char')
  }
  out.push({ kind: 'eof', text: '', value: 0, pos: n + 1 })
  return out
}

/* ------------------------------------------------------------------ *
 *  AST
 * ------------------------------------------------------------------ */

export type Ast =
  | { k: 'num'; v: number; pos: number }
  | { k: 'var'; name: string; pos: number }
  | { k: 'ref'; id: string; prop: string | null; arg: Ast | null; pos: number }
  | { k: 'un'; op: '-' | '+' | '!'; a: Ast; pos: number }
  | { k: 'bin'; op: string; a: Ast; b: Ast; pos: number }
  | { k: 'call'; name: string; args: Ast[]; pos: number }
  /** Central-difference fallback produced by `d()` over a `@` reference. */
  | { k: 'dref'; path: string; pos: number }

const COMPARISONS = new Set(['<', '>', '<=', '>=', '==', '!='])

/* ------------------------------------------------------------------ *
 *  Functions
 * ------------------------------------------------------------------ */

type Fn = (...a: number[]) => number

/** `true` mathematical mod: the result carries the sign of the divisor. */
const mod = (a: number, b: number): number => (b === 0 ? NaN : a - b * Math.floor(a / b))

export const FUNCTIONS: Record<string, { arity: number; fn: Fn; derivable: boolean }> = {
  sin: { arity: 1, fn: Math.sin, derivable: true },
  cos: { arity: 1, fn: Math.cos, derivable: true },
  tan: { arity: 1, fn: Math.tan, derivable: true },
  asin: { arity: 1, fn: Math.asin, derivable: true },
  acos: { arity: 1, fn: Math.acos, derivable: true },
  atan: { arity: 1, fn: Math.atan, derivable: true },
  sinh: { arity: 1, fn: Math.sinh, derivable: true },
  cosh: { arity: 1, fn: Math.cosh, derivable: true },
  tanh: { arity: 1, fn: Math.tanh, derivable: true },
  exp: { arity: 1, fn: Math.exp, derivable: true },
  sqrt: { arity: 1, fn: Math.sqrt, derivable: true },
  abs: { arity: 1, fn: Math.abs, derivable: false },
  ln: { arity: 1, fn: Math.log, derivable: true },
  log10: { arity: 1, fn: Math.log10, derivable: true },
  log2: { arity: 1, fn: Math.log2, derivable: true },
  floor: { arity: 1, fn: Math.floor, derivable: false },
  ceil: { arity: 1, fn: Math.ceil, derivable: false },
  round: { arity: 1, fn: Math.round, derivable: false },
  trunc: { arity: 1, fn: Math.trunc, derivable: false },
  // The fractional part. Not `x - round(x)`: that is wrong for negatives.
  frac: {
    arity: 1,
    fn: (x: number) => x - Math.floor(x),
    derivable: true,
  },
  sign: { arity: 1, fn: Math.sign, derivable: false },
  // two arguments
  atan2: { arity: 2, fn: Math.atan2, derivable: true },
  // Degrees are how the subject is taught; radians are how it is computed.
  deg: { arity: 1, fn: (x: number) => (x * 180) / Math.PI, derivable: true },
  rad: { arity: 1, fn: (x: number) => (x * Math.PI) / 180, derivable: true },
  hypot: { arity: 2, fn: Math.hypot, derivable: true },
  pow: { arity: 2, fn: Math.pow, derivable: true },
  mod: { arity: 2, fn: mod, derivable: true },
  min: { arity: 2, fn: Math.min, derivable: false },
  max: { arity: 2, fn: Math.max, derivable: false },
  // three arguments
  if: { arity: 3, fn: (c, a, b) => (c !== 0 ? a : b), derivable: false },
  clamp: {
    arity: 3,
    fn: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
    derivable: false,
  },
  lerp: { arity: 3, fn: (a, b, t) => a + (b - a) * t, derivable: true },
  // step(edge, x): 0 below the edge, 1 at or above it
  step: { arity: 2, fn: (edge, x) => (x >= edge ? 1 : 0), derivable: false },
  // Geometry helpers, for 2-D scenes where `x` and `y` are separate vars.
  // Declared with arity 0/1 so the parser accepts them; evaluated in `build`,
  // because they read the clock. `derivable` is false: a jittery signal has
  // no meaningful derivative.
  rand: { arity: 1, fn: () => 0, derivable: false },
  noise: { arity: 1, fn: () => 0, derivable: false },
  dist: { arity: 4, fn: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1), derivable: false },
  dot: { arity: 4, fn: (x1: number, y1: number, x2: number, y2: number) => x1 * x2 + y1 * y2, derivable: false },
  len: { arity: 2, fn: (x: number, y: number) => Math.hypot(x, y), derivable: false },
  smoothstep: {
    arity: 3,
    fn: (e0, e1, x) => {
      if (e1 === e0) return x < e0 ? 0 : 1
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
      return t * t * (3 - 2 * t)
    },
    derivable: false,
  },
}

/* ------------------------------------------------------------------ *
 *  Parser
 * ------------------------------------------------------------------ */

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 }

/**
 * Names a scene variable may never take. Overwriting `t` with a scene var
 * would silently break every animation on the page, so this is refused loudly
 * at import rather than at render.
 */
export const RESERVED: ReadonlySet<string> = new Set([
  't', 'lt', 'x', 'u', 'duration', 'time', 'زمان', 'مگه', 'd',
  'pi', 'e', 'tau', 'phi', 'true', 'false', 'if', 'and', 'or', 'not',
  ...Object.keys(FUNCTIONS),
])

/** `rand()` is seeded by the clock, so scrubbing back replays the same values. */
function hash01(n: number): number {
  // A cheap integer hash (xorshift-style avalanche). Deterministic across
  // machines, unlike Math.random.
  let h = Math.imul(Math.floor(n * 1e6) | 0, 0x27d4eb2d)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** 1-D gradient noise in roughly [-1, 1]; smooth, deterministic, no dependency. */
function noise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const grad = (k: number) => {
    // Hash the lattice point to a gradient in {-1, +1}.
    return hash01(k) < 0.5 ? -1 : 1
  }
  const a = grad(i)
  const b = grad(i + 1)
  const u = f * f * (3 - 2 * f)
  return a + (b - a) * u
}

class Parser {
  private i = 0
  private readonly toks: Tok[]
  private readonly scope: Scope

  constructor(toks: Tok[], scope: Scope) {
    this.toks = toks
    this.scope = scope
  }

  private peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)]
  }

  private next(): Tok {
    return this.toks[this.i++]
  }

  private eat(text: string): boolean {
    if (this.peek().text === text && this.peek().kind !== 'num') {
      this.i += 1
      return true
    }
    return false
  }

  private expect(text: string): Tok {
    if (!this.eat(text)) err(`انتظار «${text}» بود`, this.peek().pos)
    return this.toks[this.i - 1]
  }

  parse(): Ast {
    const node = this.parseOr()
    if (this.peek().kind !== 'eof') err(`نشانهٔ اضافه «${this.peek().text}»`, this.peek().pos)
    return node
  }

  private parseOr(): Ast {
    let a = this.parseAnd()
    while (this.peek().text === '||' && this.peek().kind === 'op') {
      const op = this.next()
      a = { k: 'bin', op: '||', a, b: this.parseAnd(), pos: op.pos }
    }
    return a
  }

  private parseAnd(): Ast {
    let a = this.parseComparison()
    while (this.peek().text === '&&' && this.peek().kind === 'op') {
      const op = this.next()
      a = { k: 'bin', op: '&&', a, b: this.parseComparison(), pos: op.pos }
    }
    return a
  }

  private parseComparison(): Ast {
    let a = this.parseAdditive()
    while (this.peek().kind === 'op' && COMPARISONS.has(this.peek().text)) {
      const op = this.next()
      a = { k: 'bin', op: op.text, a, b: this.parseAdditive(), pos: op.pos }
    }
    return a
  }

  private parseAdditive(): Ast {
    let a = this.parseMultiplicative()
    while (
      this.peek().kind === 'op' &&
      (this.peek().text === '+' || this.peek().text === '-')
    ) {
      const op = this.next()
      a = { k: 'bin', op: op.text, a, b: this.parseMultiplicative(), pos: op.pos }
    }
    return a
  }

  /**
   * Multiplication, division, modulo — and implicit multiplication, which is
   * what makes `2t`, `3(t+1)`, `2pi` and `(a)(b)` read like real algebra.
   */
  private parseMultiplicative(): Ast {
    let a = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '%')) {
        const op = this.next()
        a = { k: 'bin', op: op.text, a, b: this.parseUnary(), pos: op.pos }
        continue
      }
      // implicit multiplication only when the next token can start a value
      const startsValue =
        t.kind === 'num' || t.kind === 'ident' || t.kind === 'ref' || (t.kind === 'punc' && t.text === '(')
      if (!startsValue) break
      // `2e` lexes as 2 then ident e: multiplication. But `x -y` is subtraction,
      // which the additive level already consumed, so we never see a bare `-`.
      a = { k: 'bin', op: '*', a, b: this.parseUnary(), pos: t.pos }
    }
    return a
  }

  private parseUnary(): Ast {
    const t = this.peek()
    if (t.kind === 'op' && (t.text === '-' || t.text === '+' || t.text === '!')) {
      const op = this.next()
      return { k: 'un', op: op.text as '-' | '+' | '!', a: this.parseUnary(), pos: op.pos }
    }
    return this.parsePower()
  }

  private parsePower(): Ast {
    const base = this.parsePrimary()
    if (this.peek().kind === 'op' && this.peek().text === '^') {
      const op = this.next()
      // right-associative, and the exponent may itself be signed
      return { k: 'bin', op: '^', a: base, b: this.parseUnary(), pos: op.pos }
    }
    return base
  }

  private parsePrimary(): Ast {
    const t = this.next()

    if (t.kind === 'num') return { k: 'num', v: t.value, pos: t.pos }

    if (t.kind === 'punc' && t.text === '(') {
      const inner = this.parseOr()
      this.expect(')')
      return inner
    }

    if (t.kind === 'ref') {
      if (this.scope.refIds === undefined) {
        err('در اینجا ارجاع به جسم مجاز نیست', t.pos, 'ref')
      }
      if (this.scope.refIds.size > 0 && !this.scope.refIds.has(t.text)) {
        err(`جسمی به نام «${t.text}» نیست`, t.pos, 'ref')
      }
      if (!this.eat('.')) err('ارجاع @ باید ویژگی داشته باشد، مثل «@body.x»', t.pos, 'ref')
      const prop = this.next()
      if (prop.kind !== 'ident') err('بعد از «.» نام ویژگی بیاید', prop.pos, 'ref')
      // @plotId.at(x) — a lookup, evaluated against the curve
      if (prop.text === 'at' && this.eat('(')) {
        const arg = this.parseOr()
        this.expect(')')
        return { k: 'ref', id: t.text, prop: 'at', arg, pos: t.pos }
      }
      return { k: 'ref', id: t.text, prop: prop.text, arg: null, pos: t.pos }
    }

    if (t.kind === 'ident') {
      if (t.text === 'd') {
        // `d(...)` is the one operator that is not a value
        this.expect('(')
        const inner = this.parseOr()
        this.expect(')')
        return { k: 'call', name: 'd', args: [inner], pos: t.pos }
      }
      if (this.peek().kind === 'punc' && this.peek().text === '(') {
        const def = FUNCTIONS[t.text]
        this.next() // consume '('
        const args: Ast[] = []
        if (!this.eat(')')) {
          for (;;) {
            args.push(this.parseOr())
            if (this.eat(',')) continue
            this.expect(')')
            break
          }
        }
        if (!def) err(`تابعی به نام «${t.text}» نیست`, t.pos, 'function')
        if (t.text === 'rand' && args.length === 0) return { k: 'call', name: 'rand', args, pos: t.pos }
        if (def.arity === 1 && args.length !== 1) {
          err(`تابع «${t.text}» یک آرگومان می‌خواهد، نه ${fa(args.length)}`, t.pos, 'arity')
        }
        if (def.arity === 2 && args.length !== 2) {
          err(`تابع «${t.text}» دو آرگومان می‌خواهد، نه ${fa(args.length)}`, t.pos, 'arity')
        }
        if (def.arity === 3 && args.length !== 3) {
          err(`تابع «${t.text}» سه آرگومان می‌خواهد، نه ${fa(args.length)}`, t.pos, 'arity')
        }
        return { k: 'call', name: t.text, args, pos: t.pos }
      }
      if (t.text in CONSTANTS) return { k: 'var', name: t.text, pos: t.pos }
      if (!this.scope.vars.has(t.text)) {
        err(`شناسهٔ ناشناخته «${t.text}»`, t.pos, 'name')
      }
      return { k: 'var', name: t.text, pos: t.pos }
    }

    if (t.kind === 'eof') err('عبارت ناتمام است', t.pos)
    err(`انتظار یک مقدار بود، نه «${t.text}»`, t.pos)
  }
}

/* ------------------------------------------------------------------ *
 *  Compile
 * ------------------------------------------------------------------ */

type Fn1 = (env: EvalEnv) => number

/** Step size for the finite-difference fallback of `d()` over references. */
const CENTRAL_H = 1e-4

function build(node: Ast, scope: Scope): Fn1 {
  switch (node.k) {
    case 'num': {
      const v = node.v
      const f: Fn1 = () => v
      return f
    }

    case 'var': {
      const name = node.name
      if (name in CONSTANTS) {
        const v = CONSTANTS[name]
        const f: Fn1 = () => v
        return f
      }
      // t / lt / x / u are fixed slots on the environment; everything else
      // (parameters) comes out of the name map.
      const f: Fn1 =
        name === 't'
          ? (e) => e.t
          : name === 'lt'
            ? (e) => e.lt
            : name === 'x'
              ? (e) => e.x
              : name === 'u'
                ? (e) => e.u
                : (e) => e.v[name] ?? 0
      return f
    }

    case 'dref': {
      const path = node.path
      // The engine knows what a reference means; we only know it moves, so
      // ask it for the value slightly either side of now.
      const f: Fn1 = (e) =>
        e.refAt
          ? (e.refAt(path, e.t + CENTRAL_H) - e.refAt(path, e.t - CENTRAL_H)) / (2 * CENTRAL_H)
          : 0
      return f
    }

    case 'ref': {
      if (node.prop === 'at') {
        const id = node.id
        const arg = build(node.arg!, scope)
        const f: Fn1 = (e) => (e.plotAt ? e.plotAt(id, arg(e)) : 0)
        return f
      }
      const path = `${node.id}.${node.prop}`
      const f: Fn1 = (e) => (e.refAt ? e.refAt(path, e.t) : 0)
      return f
    }

    case 'un': {
      const a = build(node.a, scope)
      if (node.op === '-') return (e) => -a(e)
      if (node.op === '+') return a
      return (e) => (a(e) === 0 ? 1 : 0)
    }

    case 'bin': {
      const a = build(node.a, scope)
      const b = build(node.b, scope)
      switch (node.op) {
        case '+':
          return (e) => a(e) + b(e)
        case '-':
          return (e) => a(e) - b(e)
        case '*':
          return (e) => a(e) * b(e)
        case '/':
          return (e) => a(e) / b(e)
        case '%':
          return (e) => mod(a(e), b(e))
        case '^':
          return (e) => Math.pow(a(e), b(e))
        case '<':
          return (e) => (a(e) < b(e) ? 1 : 0)
        case '>':
          return (e) => (a(e) > b(e) ? 1 : 0)
        case '<=':
          return (e) => (a(e) <= b(e) ? 1 : 0)
        case '>=':
          return (e) => (a(e) >= b(e) ? 1 : 0)
        case '==':
          return (e) => (a(e) === b(e) ? 1 : 0)
        case '!=':
          return (e) => (a(e) !== b(e) ? 1 : 0)
        case '&&':
          return (e) => (a(e) !== 0 && b(e) !== 0 ? 1 : 0)
        case '||':
          return (e) => (a(e) !== 0 || b(e) !== 0 ? 1 : 0)
        default:
          return err(`عملگر ناشناخته «${node.op}»`, node.pos, 'operator')
      }
    }

    case 'call': {
      const args = node.args.map((a) => build(a, scope))
      if (node.name === 'd') return build(differentiate(node.args[0]), scope)

      // `rand` and `noise` need the clock, which a plain function table cannot
      // see. They are handled here and declared with arity 0/1/1 above so the
      // parser still checks them and the editor still lists them.
      if (node.name === 'rand') {
        if (args.length === 0) return (e) => hash01(e.t)
        const seed = args[0]
        // An explicit seed means a *stable* value you can reason about — the
        // clock only drives the unseeded form. Mixing t in here made a seeded
        // "random" number creep every frame, which is neither random nor fixed.
        return (e) => hash01(seed(e))
      }
      if (node.name === 'noise') {
        const a = args[0]
        return (e) => noise1(a(e))
      }

      const def = FUNCTIONS[node.name]
      if (!def) return err(`تابعی به نام «${node.name}» نیست`, node.pos, 'function')
      const fn = def.fn
      switch (args.length) {
        case 1: {
          const a = args[0]
          return (e) => fn(a(e))
        }
        case 2: {
          const a = args[0]
          const b = args[1]
          return (e) => fn(a(e), b(e))
        }
        case 3: {
          const a = args[0]
          const b = args[1]
          const c = args[2]
          return (e) => fn(a(e), b(e), c(e))
        }
        case 4: {
          const a = args[0]
          const b = args[1]
          const c = args[2]
          const d = args[3]
          return (e) => fn(a(e), b(e), c(e), d(e))
        }
        default:
          return err(`تابع «${node.name}» آرگومان بیش از حد دارد`, node.pos, 'arity')
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Differentiation
 * ------------------------------------------------------------------ */

const ADDITIVE = new Set(['+', '-'])
const MULTIPLICATIVE = new Set(['*', '/', '%'])
const ZERO: Ast = { k: 'num', v: 0, pos: 1 }
const ONE: Ast = { k: 'num', v: 1, pos: 1 }

function add(a: Ast, b: Ast, pos: number): Ast {
  return { k: 'bin', op: '+', a, b, pos }
}

function mul(a: Ast, b: Ast, pos: number): Ast {
  return { k: 'bin', op: '*', a, b, pos }
}

function div(a: Ast, b: Ast, pos: number): Ast {
  return { k: 'bin', op: '/', a, b, pos }
}

function call(name: string, args: Ast[], pos: number): Ast {
  return { k: 'call', name, args, pos }
}

/** Does this subtree depend on the clock at all? */
function isTimeDependent(a: Ast): boolean {
  switch (a.k) {
    case 'var':
      return a.name === 't' || a.name === 'lt'
    case 'ref':
      return true
    case 'num':
      return false
    case 'un':
      return isTimeDependent(a.a)
    case 'bin':
      return isTimeDependent(a.a) || isTimeDependent(a.b)
    case 'call':
      return a.name === 'd' || a.args.some(isTimeDependent)
    case 'dref':
      return true
  }
}

const WRAP = { sin: 'sin', cos: 'cos', tan: 'tan', exp: 'exp', ln: 'ln', sqrt: 'sqrt', asin: 'asin', acos: 'acos', atan: 'atan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh' } as const

/**
 * d/dx of a function call, or `null` when there is no chain rule for it.
 * `abs`, `floor`, `round`, `sign`, `mod`, `min`, `max`, `if` and friends have
 * zero derivative almost everywhere, which is the truthful answer.
 */
function dCall(node: Ast & { k: 'call' }): Ast | null {
  const { name, args, pos } = node
  if (!FUNCTIONS[name]?.derivable) return null
  const inner = differentiate(args[0])
  if (!inner) return null
  switch (name) {
    case 'sin':
      return mul(call('cos', [args[0]], pos), inner, pos)
    case 'cos':
      return { k: 'un', op: '-', a: mul(call('sin', [args[0]], pos), inner, pos), pos }
    case 'tan': {
      const c = call('cos', [args[0]], pos)
      return div(inner, mul(c, c, pos), pos)
    }
    case 'exp':
      return mul(call('exp', [args[0]], pos), inner, pos)
    case 'ln':
      return div(inner, args[0], pos)
    case 'sqrt':
      // d(√u) = u' / (2√u)
      return div(inner, { k: 'bin', op: '*', a: { k: 'num', v: 2, pos }, b: call('sqrt', [args[0]], pos), pos }, pos)
    case 'asin':
      return div(inner, call('sqrt', [{ k: 'bin', op: '-', a: ONE, b: mul(args[0], args[0], pos), pos }], pos), pos)
    case 'acos':
      return { k: 'un', op: '-', a: div(inner, call('sqrt', [{ k: 'bin', op: '-', a: ONE, b: mul(args[0], args[0], pos), pos }], pos), pos), pos }
    case 'atan':
      return div(inner, { k: 'bin', op: '+', a: ONE, b: mul(args[0], args[0], pos), pos }, pos)
    case 'deg':
      return mul(mul(inner, { k: 'num', v: 180, pos }, pos), { k: 'num', v: 1 / Math.PI, pos }, pos)
    case 'rad':
      return mul(mul(inner, { k: 'num', v: Math.PI, pos }, pos), { k: 'num', v: 1 / 180, pos }, pos)
    case 'sinh':
      return mul(call('cosh', [args[0]], pos), inner, pos)
    case 'cosh':
      return mul(call('sinh', [args[0]], pos), inner, pos)
    case 'tanh': {
      const c = call('cosh', [args[0]], pos)
      return div(inner, mul(c, c, pos), pos)
    }
    case 'pow': {
      // d(u^v) = u^v · (v'·ln u + v·u'/u)
      const u = args[0]
      const v = args[1]
      const self: Ast = { k: 'bin', op: '^', a: u, b: v, pos }
      return mul(
        self,
        add(mul(call('ln', [u], pos), differentiate(v), pos), mul(v, div(differentiate(u), u, pos), pos), pos),
        pos,
      )
    }
    case 'hypot': {
      // d(sqrt(a²+b²)) = (a·a' + b·b') / hypot(a,b)
      const a = args[0]
      const b = args[1]
      const num = add(mul(a, differentiate(a), pos), mul(b, differentiate(b), pos), pos)
      return div(num, call('hypot', [a, b], pos), pos)
    }
    case 'atan2': {
      // d(atan2(y,x)) = (x·y' − y·x') / (x² + y²)
      const y = args[0]
      const x = args[1]
      const num = { k: 'bin', op: '-', a: mul(x, differentiate(y), pos), b: mul(y, differentiate(x), pos), pos } as Ast
      return div(num, add(mul(x, x, pos), mul(y, y, pos), pos), pos)
    }
    case 'lerp': {
      // `lerp(a,b,t)` is linear in its third argument — the usual use here is
      // animating between two shapes, and that is the part people want d/dt of.
      const arg = args[args.length - 1]
      if (args.length === 3 && name === 'lerp') return differentiate(arg)!
      return null
    }
    case 'mod': {
      // d(mod(a,b)) = d(a) for constant b
      return differentiate(args[0])
    }
    default:
      void WRAP[name as keyof typeof WRAP]
      return null
  }
}

/**
 * Symbolic derivative with respect to the clock.
 *
 * `x` and `u` are axis variables, not time, so they differentiate to zero;
 * parameters are held constant. References cannot be differentiated without
 * the engine, so `d()` over a reference becomes a central difference — see
 * {@link buildDRef}.
 */
export function differentiate(a: Ast): Ast {
  if (!isTimeDependent(a)) return ZERO

  switch (a.k) {
    case 'var':
      return a.name === 't' || a.name === 'lt' ? ONE : ZERO

    case 'ref': {
      if (a.prop === null || a.prop === 'at') return ZERO
      return { k: 'dref', path: `${a.id}.${a.prop}`, pos: a.pos }
    }

    case 'num':
      return ZERO

    case 'un':
      if (a.op === '+') return differentiate(a.a)
      if (a.op === '-') return { k: 'un', op: '-', a: differentiate(a.a), pos: a.pos }
      return ZERO

    case 'bin': {
      const { op, a: l, b: r, pos } = a
      if (ADDITIVE.has(op)) {
        const dl = differentiate(l)
        const dr = differentiate(r)
        return op === '+' ? add(dl, dr, pos) : { k: 'bin', op: '-', a: dl, b: dr, pos }
      }
      if (MULTIPLICATIVE.has(op)) {
        const dl = differentiate(l)
        const dr = differentiate(r)
        if (op === '*') return add(mul(dl, r, pos), mul(l, dr, pos), pos)
        if (op === '/') {
          // d(u/v) = u'/v − u·v'/v²
          const inv = call('pow', [r, { k: 'num', v: -1, pos }], pos)
          const inv2 = mul(inv, inv, pos)
          return {
            k: 'bin',
            op: '-',
            a: mul(dl, inv, pos),
            b: mul(l, mul(dr, inv2, pos), pos),
            pos,
          }
        }
        // mod: the quotient term vanishes where the modulus is constant
        return dl
      }
      if (op === '^') {
        // d(u^v) = u^v * (v' * ln u + v * u' / u)
        const b = r
        const self: Ast = { k: 'bin', op: '^', a: l, b, pos }
        const term = add(
          mul(call('ln', [l], pos), differentiate(b), pos),
          mul(b, div(differentiate(l), l, pos), pos),
          pos,
        )
        return mul(self, term, pos)
      }
      // comparisons and logic are piecewise constant
      return ZERO
    }

    case 'dref':
      return ZERO

    case 'call':
      return dCall(a) ?? ZERO
  }
}

/* ------------------------------------------------------------------ *
 *  Dependency collection
 * ------------------------------------------------------------------ */

export type ExprDeps = {
  names: string[]
  refs: string[]
  timeDependent: boolean
}

export function collectDeps(root: Ast): ExprDeps {
  const names = new Set<string>()
  const refs = new Set<string>()
  let timeDependent = false
  const walk = (a: Ast): void => {
    switch (a.k) {
      case 'num':
        return
      case 'var':
        names.add(a.name)
        if (a.name === 't' || a.name === 'lt') timeDependent = true
        return
      case 'ref':
        refs.add(a.prop === 'at' ? `${a.id}.at` : `${a.id}.${a.prop}`)
        timeDependent = true
        return
      case 'un':
        walk(a.a)
        return
      case 'bin':
        walk(a.a)
        walk(a.b)
        return
      case 'call':
        a.args.forEach(walk)
        timeDependent = true
        return
      case 'dref':
        refs.add(a.path)
        timeDependent = true
        return
    }
  }
  walk(root)
  return { names: [...names], refs: [...refs], timeDependent }
}

/* ------------------------------------------------------------------ *
 *  Cache
 * ------------------------------------------------------------------ */

const CACHE_LIMIT = 500
const cache = new Map<string, CompiledExpr>()

function scopeKey(scope: Scope): string {
  const vars = [...scope.vars].sort().join(',')
  const refs = scope.refIds ? [...scope.refIds].sort().join(',') : ' none'
  return `${vars}|${refs}`
}

function remember(key: string, value: CompiledExpr): void {
  // Map preserves insertion order, so the first key is the oldest.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

/** Compile, or throw {@link ExprError} with a Persian message. */
export function compileExpr(source: string, scope: Scope): CompiledExpr {
  const key = `${scopeKey(scope)} ${source}`
  const hit = cache.get(key)
  if (hit) {
    // refresh recency
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const ast = new Parser(tokenize(source), scope).parse()
  const deps = collectDeps(ast)
  const fn = build(ast, scope)

  const raw = (env: EvalEnv): number => {
    const v = fn(env)
    // NaN would otherwise poison every downstream path and label; a broken
    // expression should show up as *nothing*, not as the whole scene.
    return Number.isNaN(v) ? 0 : v
  }
  const compiled = raw as CompiledExpr
  Object.defineProperties(compiled, {
    source: { value: source, enumerable: true },
    deps: { value: Object.freeze(deps.names), enumerable: true },
    refs: { value: Object.freeze(deps.refs), enumerable: true },
    timeDependent: { value: deps.timeDependent, enumerable: true },
  })

  remember(key, compiled)
  return compiled
}

/** Non-throwing compile, for live validation in the inspector. */
export function validateExpr(
  source: string,
  scope: Scope,
): { ok: true; deps: ExprDeps } | { ok: false; message: string; pos: number } {
  try {
    const ast = new Parser(tokenize(source), scope).parse()
    return { ok: true, deps: collectDeps(ast) }
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, message: e.message, pos: e.pos }
    return { ok: false, message: String(e), pos: 1 }
  }
}

/** Convenience: compile and evaluate in one call. Tests and one-offs. */
export function evalExpr(
  source: string,
  scope: Scope,
  env: EvalEnv,
): number {
  return compileExpr(source, scope)(env)
}

export function clearExprCache(): void {
  cache.clear()
}

export function exprCacheSize(): number {
  return cache.size
}

/** Helpers used by the test suite and by the studio's example chips. */
export const EXPR_HELP = {
  vars: ['t', 'lt', 'x', 'u'],
  functions: Object.keys(FUNCTIONS),
  operators: [...OPERATORS, '()'],
} as const