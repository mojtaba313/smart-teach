/**
 * Reading an image off the system clipboard.
 *
 * `navigator.clipboard.read()` is the only way to grab an image the user copied
 * somewhere else — a screenshot from another app, an image in a PDF — without
 * asking them to find and focus a paste target first. It is also Chromium-only,
 * and it throws when permission is refused, so every failure mode here is a
 * normal return rather than an exception the caller has to guess at.
 */

export type ClipboardImageResult =
  | { ok: true; file: File }
  | { ok: false; reason: 'unsupported' | 'denied' | 'empty' }

/** Search order, most likely clipboard image first. */
const PREFERRED = ['image/png', 'image/webp', 'image/avif', 'image/jpeg', 'image/gif']

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** Whether this browser can do it at all. Safari and Firefox cannot, yet. */
export function canReadClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.read === 'function'
  )
}

/**
 * Pull the first image out of a list of clipboard items.
 *
 * `ClipboardItem` has no portable way to inspect its blob types, so the
 * preference order is expressed by `types` — `image/png` first, because a
 * screenshot is almost always a PNG and re-encoding it is wasted work.
 */
export function firstImageBlob(items: readonly ClipboardItem[]): Promise<Blob | null> {
  const supported = new Set(Object.keys(EXT_BY_TYPE))
  // Pass over the whole clipboard first, keeping the first entry of each type.
  // Iterating item-by-item would take whatever the source app happened to list
  // first, so a clipboard holding both a JPEG and a PNG would yield the JPEG
  // and pay a re-encode for no reason.
  const wanted = new Set<string>()
  for (const item of items) {
    for (const t of item.types) {
      if (supported.has(t)) wanted.add(t)
    }
  }
  const best = PREFERRED.find((t) => wanted.has(t))
  if (!best) return Promise.resolve(null)

  for (const item of items) {
    if (!item.types.includes(best)) continue
    return item.getType(best).then(
      (blob) => blob,
      () => null,
    )
  }
  return Promise.resolve(null)
}

function extensionFor(type: string): string {
  return EXT_BY_TYPE[type] ?? 'png'
}

/**
 * Read one image from the clipboard.
 *
 * The file is named from its MIME type rather than from whatever the source app
 * called it — a screenshot copied from a browser is usually called something
 * unhelpful, and the extension is what the storage layer keys off anyway.
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  if (!canReadClipboard()) return { ok: false, reason: 'unsupported' }

  let items: ClipboardItem[]
  try {
    items = await navigator.clipboard.read()
  } catch {
    // Denied permission, or the document is not focused. Both are ordinary.
    return { ok: false, reason: 'denied' }
  }

  const blob = await firstImageBlob(items)
  if (!blob || blob.size === 0) return { ok: false, reason: 'empty' }

  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = new File([blob], `paste-${stamp}.${extensionFor(blob.type)}`, {
    type: blob.type,
  })
  return { ok: true, file }
}

/** A message fit to show next to the button. */
export function clipboardErrorMessage(reason: ClipboardImageResult & { ok: false }): string {
  switch (reason.reason) {
    case 'unsupported':
      return 'این مرورگر خواندن از کلیپ‌بورد را پشتیبانی نمی‌کند. تصویر را بکشید و رها کنید یا فایل انتخاب کنید.'
    case 'denied':
      return 'دسترسی به کلیپ‌بورد داده نشد. تصویر را در کادر زیر بچسبانید.'
    case 'empty':
      return 'در کلیپ‌بورد تصویری پیدا نشد.'
  }
}