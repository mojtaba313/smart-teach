/**
 * Delete one stored image.
 *
 * The name arrives URL-encoded and is re-validated before it is used: this
 * value is concatenated into a path that GitHub will act on, so a traversal
 * like `..%2F..%2F.env` must never reach the API.
 */

import { NextResponse } from 'next/server'
import { BucketError, configFromEnv, find, remove } from '../../../../lib/storage/github'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The generated names contain no path separators; anything else is refused. */
const NAME_RE = /^[A-Za-z0-9._-]+\.(png|jpg|webp|gif|avif)$/

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const config = configFromEnv()
  if (!config) {
    return NextResponse.json(
      { error: 'بارگذاری تصویر پیکربندی نشده است.' },
      { status: 501 },
    )
  }

  const { name } = await params
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: 'نام فایل نامعتبر است.' }, { status: 400 })
  }

  try {
    // Deleting needs the current SHA, so read the entry first.
    const image = await find(config, name)
    if (!image) {
      return NextResponse.json({ error: 'چنین تصویری نیست.' }, { status: 404 })
    }
    await remove(config, image)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const status = e instanceof BucketError ? (e.local ? e.status ?? 400 : e.status ?? 502) : 502
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'حذف ناکام ماند.' },
      { status },
    )
  }
}
