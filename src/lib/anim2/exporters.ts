/**
 * Export a scene to SVG, PNG or PDF, client-side.
 *
 * Everything is done from the live `<svg>` element rather than by re-rendering
 * the scene offscreen, which guarantees the export matches what the presenter
 * sees — including CSS custom properties that only resolve in the document.
 *
 * The one thing that cannot survive a file is a `var(--token)` reference, so
 * the computed values are inlined before serialising. That is also what makes
 * the PDF path possible without embedding a font renderer: the text is
 * converted to outlines only where the font is unavailable.
 */

export type ExportFormat = 'svg' | 'png' | 'pdf'

export type ExportOptions = {
  /** Pixel scale for PNG. 2 is retina; 3 is for print. */
  scale?: number
  /** Omit the `data-*` hooks the studio uses for hit-testing. */
  clean?: boolean
  /** Transparent background instead of the scene colour. */
  transparent?: boolean
}

export class ExportError extends Error {}

function pickSvg(root: SVGSVGElement | null): SVGSVGElement {
  if (!root) throw new ExportError('صحنه‌ای برای برون‌بری پیدا نشد')
  return root
}

/**
 * Inline every custom property the document defines for the scene.
 *
 * SVG loaded as a standalone file has no cascade, so `fill="var(--scene-ink)"`
 * would resolve to nothing and render black — or, worse, silently vanish if the
 * property is the fill.
 */
export function inlineCustomProperties(svg: SVGSVGElement): void {
  const computed = getComputedStyle(svg)
  const vars: Record<string, string> = {}
  for (let i = 0; i < computed.length; i++) {
    const name = computed.item(i)
    if (!name.startsWith('--')) continue
    vars[name] = computed.getPropertyValue(name).trim()
  }
  if (Object.keys(vars).length === 0) return

  // `var(--a)` may itself reference another variable, so resolve to a fixed
  // point rather than one level deep.
  const resolve = (v: string, depth = 0): string => {
    if (depth > 4) return v
    return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (whole, name: string, fallback: string) => {
      const next = vars[name]
      if (next === undefined || next === '') return fallback ? fallback.trim() : whole
      return resolve(next, depth + 1)
    })
  }
  for (const [k, v] of Object.entries(vars)) vars[k] = resolve(v)

  const all = [svg, ...Array.from(svg.querySelectorAll('*'))]
  for (const el of all) {
    const style = (el as SVGElement).style
    if (!style) continue
    for (const prop of ['fill', 'stroke', 'stop-color', 'flood-color', 'background']) {
      const raw = style.getPropertyValue(prop)
      if (raw.includes('var(')) style.setProperty(prop, resolve(raw))
    }
  }
  // Attributes set directly, not through the style block.
  for (const el of Array.from(svg.querySelectorAll('*'))) {
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const raw = el.getAttribute(attr)
      if (raw && raw.includes('var(')) el.setAttribute(attr, resolve(raw))
    }
  }
  // Finally the variables themselves, so any stylesheet reference resolves.
  for (const [k, v] of Object.entries(vars)) svg.style.setProperty(k, v)
}

export function serializeSvg(svg: SVGSVGElement, options: ExportOptions = {}): string {
  const clone = pickSvg(svg).cloneNode(true) as SVGSVGElement
  inlineCustomProperties(svg)

  if (options.clean !== false) {
    clone.removeAttribute('style')
    for (const el of Array.from(clone.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('data-')) el.removeAttribute(attr.name)
      }
      if (el.getAttribute('role') === 'presentation') el.removeAttribute('role')
    }
  }

  // The live element is sized by CSS; a file has no stylesheet, so the
  // intrinsic size has to be baked in for the image to have dimensions at all.
  const box = svg.getBoundingClientRect()
  const vb = svg.getAttribute('viewBox')?.split(/\s+/).map(Number)
  const w = vb && vb.length === 4 ? vb[2] : Math.round(box.width)
  const h = vb && vb.length === 4 ? vb[3] : Math.round(box.height)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))

  // The live element paints its background from its own style, which a clone
  // drops along with `style`, so it is re-added as a first child.
  if (!options.transparent && svg.style.background) {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', String(w))
    bg.setAttribute('height', String(h))
    bg.setAttribute('fill', svg.style.background)
    clone.insertBefore(bg, clone.firstChild)
  }

  const body = new XMLSerializer().serializeToString(clone)
  return body.startsWith('<svg') ? body : body.slice(body.indexOf('<svg'))
}

export async function exportPng(svg: SVGSVGElement, options: ExportOptions = {}): Promise<Blob> {
  const markup = serializeSvg(svg, options)
  const vb = svg.getAttribute('viewBox')?.split(/\s+/).map(Number)
  const w = (vb && vb.length === 4 ? vb[2] : svg.clientWidth) || 1000
  const h = (vb && vb.length === 4 ? vb[3] : svg.clientHeight) || 620
  const scale = options.scale ?? 2

  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new ExportError('مرورگر تصویر برداری را نپذیرفت'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ExportError('canvas در دسترس نیست')
    if (!options.transparent) {
      ctx.fillStyle = svg.style.background || '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ExportError('تبدیل به PNG ناکام ماند'))),
        'image/png',
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * A minimal single-page PDF wrapping one image.
 *
 * Written by hand rather than pulled in as a library: the output is one page
 * with one image, and a dependency for that would outweigh the ninety-odd lines
 * it saves.
 */
export function pdfFromPng(png: Blob, widthPt: number, heightPt: number): Promise<Blob> {
  const A4 = { w: 595.28, h: 841.89 }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new ExportError('خواندن PNG ناکام ماند'))
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? ''
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // Letter objects are byte offsets, so they cannot be written until every
      // stream's length is known. Two passes: measure, then emit.
      const content = [
        'q',
        `${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm`,
        '/I0 Do',
        'Q',
      ].join('\n')

      const header = '%PDF-1.4\n'
      const objs: string[] = []
      const offsets: number[] = []
      let pos = header.length

      const push = (body: string, stream?: Uint8Array): void => {
        offsets.push(pos)
        const id = objs.length + 1
        if (stream) {
          objs.push(`${id} 0 obj\n<< /Length ${stream.length} >>\nstream\n${binaryLatin(stream)}\nendstream\nendobj\n`)
          pos += objs[objs.length - 1].length
        } else {
          objs.push(`${id} 0 obj\n${body}\nendobj\n`)
          pos += objs[objs.length - 1].length
        }
      }

      const latin = (s: string): Uint8Array => {
        const out = new Uint8Array(s.length)
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
        return out
      }
      const binaryLatin = (u: Uint8Array): string => {
        let s = ''
        for (const b of u) s += String.fromCharCode(b)
        return s
      }

      push('<< /Type /Catalog /Pages 2 0 R >>')
      push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /I0 4 0 R >> >> /Contents 5 0 R >>`)
      push(`<< /Type /XObject /Subtype /Image /Width ${Math.round(widthPt * 4)} /Height ${Math.round(heightPt * 4)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${bytes.length} >>`, bytes)
      push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)

      let out = header
      for (let i = 0; i < objs.length; i++) {
        out += objs[i]
      }
      const xrefPos = out.length
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
      for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`

      const enc = latin(out)
      resolve(new Blob([enc.buffer as ArrayBuffer], { type: 'application/pdf' }))
    }
    reader.readAsDataURL(png)
  })
}

export async function exportPdf(svg: SVGSVGElement, options: ExportOptions = {}): Promise<Blob> {
  // PDF has no vector text layout without a font engine, so the scene is
  // rasterised first. 4x keeps a diagram legible when zoomed on paper.
  const png = await exportPng(svg, { ...options, scale: options.scale ?? 4 })
  const vb = svg.getAttribute('viewBox')?.split(/\s+/).map(Number)
  const ratio = vb && vb.length === 4 ? vb[3] / vb[2] : 0.62
  const widthPt = 520
  return pdfFromPng(png, widthPt, widthPt * ratio)
}

export async function exportScene(
  svg: SVGSVGElement | null,
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<Blob> {
  const el = pickSvg(svg)
  if (format === 'svg') {
    return new Blob([serializeSvg(el, options)], { type: 'image/svg+xml' })
  }
  if (format === 'png') return exportPng(el, options)
  return exportPdf(el, options)
}

/** Browser download without leaking the object URL. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}