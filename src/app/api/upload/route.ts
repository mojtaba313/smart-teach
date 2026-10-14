/**
 * Image upload, backed by Vercel Blob.
 *
 * The editor stores a URL in the step, and this is the only thing that turns a
 * local file into one. Keeping the upload server-side means the token never
 * reaches the browser — a client-side token is a public write key, and a
 * public write key on a bucket that holds a user's homework is not a
 * distinction anyone wants to debug later.
 *
 * Uploads are deliberately limited to images and capped in size. This route is
 * reachable without a session check, so it cannot be the thing that trusts the
 * browser about anything except the file's own bytes.
 */

import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Vercel Blob's own single-put ceiling. */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Formats accepted as images. SVG is excluded on purpose: an SVG is a script
 * container, and serving one inline from our own origin is a stored-XSS vector
 * that no amount of `Content-Security-Policy` on the app will fully contain.
 */
const ALLOWED = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
])

function extensionOf(name: string, fallback: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name)
  return m ? m[1].toLowerCase() : fallback
}

/**
 * A filesystem-safe prefix. Client-supplied names are untrusted, so only the
 * extension is carried over and the stem is replaced entirely.
 */
function safeName(raw: string, fallbackExt: string): string {
  const ext = extensionOf(raw, fallbackExt)
  if (!/^(png|jpg|jpeg|webp|gif|avif)$/.test(ext)) return `upload.${fallbackExt}`
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext === 'jpeg' ? 'jpg' : ext}`
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'بارگذاری تصویر پیکربندی نشده است (BLOB_READ_WRITE_TOKEN تنظیم نشده).' },
      { status: 501 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'درخواست باید multipart باشد.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'فایلی ارسال نشد.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'فایل خالی است.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `حجم فایل بیش از حد است (سقف ${Math.round(MAX_BYTES / 1024 / 1024)} مگابایت).` },
      { status: 413 },
    )
  }

  const ext = ALLOWED.get(file.type)
  if (!ext) {
    return NextResponse.json(
      { error: `این قالب پشتیبانی نمی‌شود. قالب‌های مجاز: ${[...ALLOWED.keys()].join('، ')}` },
      { status: 415 },
    )
  }

  try {
    const result = await put(`images/${safeName(file.name, ext)}`, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    })
    return NextResponse.json({ url: result.url, pathname: result.pathname, size: file.size })
  } catch (e) {
    // The token is missing or rejected far more often than the network fails,
    // and the SDK's message is the only thing that distinguishes them.
    const detail = e instanceof Error ? e.message : 'نامشخص'
    console.error('[upload] blob put failed', detail)
    return NextResponse.json({ error: 'بارگذاری ناکام ماند. تنظیمات ذخیره‌سازی را بررسی کنید.' }, { status: 502 })
  }
}
