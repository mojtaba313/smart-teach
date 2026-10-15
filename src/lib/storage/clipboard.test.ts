import { describe, expect, it } from 'vitest'
import { clipboardErrorMessage, firstImageBlob } from './clipboard'

/** A ClipboardItem stand-in; the real one needs a live user gesture. */
const item = (types: string[], blobs: Record<string, Blob | null>): ClipboardItem =>
  ({
    types,
    getType: (t: string) =>
      t in blobs
        ? Promise.resolve(blobs[t] as Blob)
        : Promise.reject(new Error(`no ${t}`)),
  }) as unknown as ClipboardItem

const png = (bytes = 8): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

describe('firstImageBlob', () => {
  it('picks the only image out of a mixed clipboard', async () => {
    const items = [
      item(['text/plain'], { 'text/plain': new Blob(['hello']) }),
      item(['image/png'], { 'image/png': png() }),
    ]
    const blob = await firstImageBlob(items)
    expect(blob?.type).toBe('image/png')
  })

  it('prefers PNG, since a screenshot is nearly always one', async () => {
    // Re-encoding a clipboard image costs a round trip and loses quality; the
    // common case should not pay for the rare one.
    const items = [
      item(['image/jpeg'], { 'image/jpeg': new Blob([''], { type: 'image/jpeg' }) }),
      item(['image/png'], { 'image/png': png() }),
    ]
    expect((await firstImageBlob(items))?.type).toBe('image/png')
  })

  it('takes a later item when the first has no image type', async () => {
    const items = [
      item(['text/html'], { 'text/html': new Blob(['<b>x</b>']) }),
      item(['image/webp'], { 'image/webp': new Blob([''], { type: 'image/webp' }) }),
    ]
    expect((await firstImageBlob(items))?.type).toBe('image/webp')
  })

  it('returns null for a clipboard holding only text', async () => {
    expect(await firstImageBlob([item(['text/plain'], { 'text/plain': new Blob(['x']) })])).toBeNull()
  })

  it('returns null rather than rejecting when the blob cannot be read', async () => {
    // A clipboard entry can vanish between listing and reading; that must not
    // surface as an unhandled rejection in the click handler.
    const items = [item(['image/png'], { 'image/png': null })]
    expect(await firstImageBlob(items)).toBeNull()
  })

  it('returns null for an empty clipboard', async () => {
    expect(await firstImageBlob([])).toBeNull()
  })

  it('ignores types the storage layer would reject anyway', async () => {
    const items = [item(['image/svg+xml'], { 'image/svg+xml': new Blob(['']) })]
    expect(await firstImageBlob(items)).toBeNull()
  })
})

describe('clipboardErrorMessage', () => {
  it('offers a way forward for every case rather than just failing', () => {
    // Each of these is reachable in normal use, and "unsupported" is the one
    // a user hits permanently.
    expect(clipboardErrorMessage({ ok: false, reason: 'unsupported' })).toContain('پشتیبانی')
    expect(clipboardErrorMessage({ ok: false, reason: 'denied' })).toContain('کلیپ‌بورد')
    expect(clipboardErrorMessage({ ok: false, reason: 'empty' })).toContain('پیدا نشد')
  })
})