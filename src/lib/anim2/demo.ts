/**
 * Demo JSON import and export.
 *
 * A demo is not a deck: it is a single animation plus the prose that frames
 * it. Bundling them into one file is what makes a lesson portable — a teacher
 * can hand someone a file and they get the same scene, the same controls and
 * the same narration.
 *
 * Import is deliberately forgiving about ids and versions, because a demo file
 * is something people edit by hand. Export is deliberately strict, so what
 * comes out is what goes in.
 */

import type { Animation2 } from '../../types/anim2'
import { ANIM2_SCHEMA, LIMITS } from '../../types/anim2'
import { migrateAnimationV1toV2 } from '../../model/migrateAnimationV1toV2'

export const DEMO_FORMAT = 'smart-teach-demo'
export const DEMO_VERSION = 1

export type Demo = {
  format: typeof DEMO_FORMAT
  version: number
  title: string
  /** Optional slide heading the demo came from. */
  caption?: string
  animation: Animation2
  /** How to play it: which controls to surface, what to say first. */
  notes?: string
  createdAt?: string
}

export type DemoImport =
  | { ok: true; demo: Demo; warnings: string[] }
  | { ok: false; error: string }

/** Strip nothing — a demo is the document, exported verbatim and re-importable. */
export function toDemo(anim: Animation2, opts: { title?: string; caption?: string; notes?: string } = {}): Demo {
  return {
    format: DEMO_FORMAT,
    version: DEMO_VERSION,
    title: opts.title ?? anim.title ?? 'دمو',
    caption: opts.caption,
    notes: opts.notes,
    animation: anim,
    createdAt: new Date().toISOString(),
  }
}

export function serializeDemo(demo: Demo): string {
  // Two spaces, and a trailing newline: a demo file is meant to be read,
  // diffed and version-controlled, so it should look like source.
  return `${JSON.stringify(demo, null, 2)}\n`
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/**
 * Parse a demo file.
 *
 * A bare animation is accepted too — pasting an animation into the import box
 * should work, since that is what a reader will try first and the error is
 * cheap to avoid.
 */
export function parseDemo(input: string): DemoImport {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch (e) {
    return { ok: false, error: `JSON خوانده نشد: ${e instanceof Error ? e.message : 'نامشخص'}` }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'محتوا یک شیء نبود' }

  const obj = raw as Record<string, unknown>
  const warnings: string[] = []

  let animSrc = obj.animation
  if (!animSrc) {
    // A bare animation, or a v1 document, is fine.
    if (obj.nodes || obj.series) {
      animSrc = obj
      warnings.push('فایل، خودِ انیمیشن بود؛ بدون فراداده پذیرفته شد')
    } else {
      return { ok: false, error: 'کلید animation پیدا نشد' }
    }
  }
  if (!animSrc || typeof animSrc !== 'object') {
    return { ok: false, error: 'animation یک شیء نبود' }
  }

  if (obj.format !== undefined && obj.format !== DEMO_FORMAT) {
    warnings.push(`قالب ناشناخته «${String(obj.format)}»؛ به‌عنوان دمو پذیرفته شد`)
  }
  const version = typeof obj.version === 'number' ? obj.version : DEMO_VERSION
  if (version > DEMO_VERSION) {
    warnings.push(`نسخهٔ ${version} تازه‌تر از پشتیبانی‌شده است؛ فیلدهای ناشناخته نادیده گرفته می‌شوند`)
  }

  let anim: Animation2
  try {
    // Reuse the v1→v2 path so a demo file may hold either version.
    const migrated = migrateAnimationV1toV2(animSrc as never)
    anim = 'anim' in migrated ? migrated.anim : (migrated as unknown as Animation2)
  } catch (e) {
    return { ok: false, error: `انیمیشن خوانده نشد: ${e instanceof Error ? e.message : 'نامشخص'}` }
  }

  if (anim.duration < LIMITS.minDuration || anim.duration > LIMITS.maxDuration) {
    warnings.push(`مدت ${anim.duration} به ${LIMITS.maxDuration} محدود شد`)
    anim = { ...anim, duration: Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, anim.duration)) }
  }
  if (anim.nodes.length > LIMITS.maxNodes) {
    warnings.push(`${anim.nodes.length} گره؛ تنها ${LIMITS.maxNodes} نخست نگه داشته شد`)
    anim = { ...anim, nodes: anim.nodes.slice(0, LIMITS.maxNodes) }
  }
  if ((anim.drawings?.length ?? 0) > LIMITS.maxNodes) {
    warnings.push('رسم‌ها بیش از حد بودند؛ بریده شد')
    anim = { ...anim, drawings: anim.drawings?.slice(0, LIMITS.maxNodes) }
  }
  if (anim.schema !== ANIM2_SCHEMA) {
    warnings.push('نسخهٔ انیمیشن پس از مهاجرت هنوز v2 نشد')
  }

  return {
    ok: true,
    demo: {
      format: DEMO_FORMAT,
      version: DEMO_VERSION,
      title: str(obj.title, anim.title) || 'دمو',
      caption: typeof obj.caption === 'string' ? obj.caption : undefined,
      notes: typeof obj.notes === 'string' ? obj.notes : undefined,
      animation: anim,
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : undefined,
    },
    warnings,
  }
}

/** A filename that will not confuse a filesystem. */
export function demoFilename(title: string, ext: string): string {
  const safe = title.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${safe || 'demo'}.${ext}`
}