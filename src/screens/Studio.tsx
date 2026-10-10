import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Camera,
  CircleDot,
  Eraser,
  Keyboard,
  Layers,
  LineChart,
  MousePointerClick,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Spline,
  Square,
  Undo2,
} from 'lucide-react'
import type { AnimLayer, AnimProp, Animation, AnimSeries, SlideStep } from '../types'
import { ANIM_PROPS, emptyAnimation, newKey } from '../types'
import { usePresentations, putPresentation } from '../lib/store'
import { popOverlay, pushOverlay, useLocalKeys } from '../lib/hotkeys'
import {
  allKeyframes,
  animationDuration,
  sceneUnit,
  keyframeExtent,
  layerPos,
  scenePanels,
  seriesLookupOf,
  withKey,
  withoutKey,
  wrapTime,
} from '../lib/anim/engine'
import { PRESETS } from '../lib/anim/presets'
import { useNav } from '../lib/nav'
import { clamp, cn, round, toFaDigits } from '../lib/utils'
import { Badge, Button, Empty, IconButton, Segmented } from '../components/ui/primitives'
import { Confirm, Modal, toast } from '../components/ui/overlay'
import { AnimationScene } from '../components/anim/Scene'
import { Timeline } from '../components/anim/Timeline'
import { AddLayerButton, AddSeriesButton, LayerInspector, SceneInspector, SeriesInspector } from '../components/anim/inspectors'

type Target = { kind: 'layer'; id: string } | { kind: 'series'; id: string } | { kind: 'scene' }

function NumInput({
  value,
  step,
  min,
  suffix,
  onChange,
}: {
  value: number
  step: number
  min: number
  suffix: string
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      value={Number(value.toFixed(2))}
      step={step}
      min={min}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      className="h-7 w-16 rounded-lg border border-hairline bg-surface px-1.5 text-xs font-black tabular-nums"
      aria-label={suffix}
    />
  )
}

export default function Studio() {
  const params = useParams<{ presId: string; slideId: string; stepId: string }>()
  const presId = params?.presId ?? ''
  const stepId = params?.stepId ?? ''
  const { go: navigate } = useNav()
  const library = usePresentations()
  const pres = library.find((p) => p.id === presId)

  const located = (() => {
    if (!pres) return null
    for (const slide of pres.slides) {
      const i = slide.steps.findIndex((s) => s.id === stepId)
      if (i >= 0) return { slide, index: i }
    }
    return null
  })()

  const original = located?.slide.steps[located.index]

  /* ---- local editing state (undoable) ---- */
  // Cloned once: `useState` keeps this value, so re-cloning every render is
  // pure waste on a scene with keyframes.
  const [seedAnim] = useState<Animation>(() =>
    original?.kind === 'animation' ? structuredClone(original.anim) : emptyAnimation(),
  )
  const [anim, setAnim] = useState<Animation>(seedAnim)
  const [title, setTitle] = useState(() => (original?.kind === 'animation' ? original.anim.title : ''))
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() => seedAnim.layers[0]?.id ?? null)

  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedScale, setSpeedScale] = useState(1)
  const [timeSnap, setTimeSnap] = useState(0.1)
  const [target, setTarget] = useState<Target>(() =>
    seedAnim.layers.length > 0 ? { kind: 'layer', id: seedAnim.layers[0].id } : seedAnim.series.length > 0 ? { kind: 'series', id: seedAnim.series[0].id } : { kind: 'scene' },
  )
  const [selectedKey, setSelectedKey] = useState<{ layerId: string; prop: string; keyId: string } | null>(null)
  /**
   * Record mode — build a motion by acting it out.
   *
   * Drag the object and every gesture is stored as a keyframe at the current
   * time, in the order it was made; the clock then jumps one beat forward so
   * the next pose lands after the last one. No formulas, no hand-placed
   * keys on a ruler: you move the thing and it happens in that order.
   */
  const [recording, setRecording] = useState(false)
  const [beat, setBeat] = useState(0.5)
  /** drawing a path by clicking the scene, rather than dragging the object */
  const [pathDraw, setPathDraw] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    pushOverlay()
    return () => popOverlay()
  }, [])

  const duration = animationDuration(anim)
  const lookupOf = (a: Animation) => seriesLookupOf(a)

  /* ---- mutation with history ---- */
  const past = useRef<Animation[]>([])
  const future = useRef<Animation[]>([])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })

  const patch = useCallback(
    (next: Animation) => {
      past.current.push(anim)
      if (past.current.length > 80) past.current.shift()
      future.current = []
      setAnim(next)
      setDirty(true)
      setHistory({ canUndo: true, canRedo: false })
    },
    [anim],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(anim)
    setAnim(prev)
    setDirty(true)
    setHistory({ canUndo: past.current.length > 0, canRedo: true })
  }, [anim])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(anim)
    setAnim(next)
    setDirty(true)
    setHistory({ canUndo: true, canRedo: future.current.length > 0 })
  }, [anim])

  /* ---- playback ---- */
  const frame = useRef<number | null>(null)
  const last = useRef(0)
  useEffect(() => {
    if (!playing) {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = null
      return
    }
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last.current) / 1000)
      last.current = now
      setT((prev) => {
        const adv = prev + dt * anim.speed * speedScale
        if (!anim.loop && adv >= duration) {
          setPlaying(false)
          return duration
        }
        return wrapTime(adv, anim)
      })
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [playing, anim, duration, speedScale])

  const seek = useCallback((v: number) => setT(clamp(v, 0, duration)), [duration])

  /* ---- persistence ---- */
  const commit = useCallback(() => {
    if (!pres || !located || !original || original.kind !== 'animation') return
    const next: Animation = { ...anim, title: title.trim() || 'بی‌نام' }
    const steps: SlideStep[] = [...located.slide.steps]
    steps[located.index] = { ...original, anim: next }
    putPresentation({
      ...pres,
      slides: pres.slides.map((s) => (s.id === located.slide.id ? { ...s, steps } : s)),
    })
    setDirty(false)
  }, [pres, located, original, anim, title])

  // Debounced autosave keeps the deck in sync without hammering localStorage.
  useEffect(() => {
    if (!dirty) return
    const id = setTimeout(commit, 700)
    return () => clearTimeout(id)
  }, [dirty, commit])

  /* ---- targeted patches ---- */
  const patchLayer = useCallback(
    (next: AnimLayer) => patch({ ...anim, layers: anim.layers.map((l) => (l.id === next.id ? next : l)) }),
    [anim, patch],
  )
  const patchSeries = useCallback(
    (next: AnimSeries) => patch({ ...anim, series: anim.series.map((s) => (s.id === next.id ? next : s)) }),
    [anim, patch],
  )

  /* ---- keyframe ops ---- */
  const layer = anim.layers.find((l) => l.id === selectedLayerId) ?? null
  const series = anim.series.find((s) => s.id === (target.kind === 'series' ? target.id : '')) ?? null

  /**
   * Store the pose of a layer at time `at`, switching it to keyframe mode.
   * Recording always moves *forward*, so the keys land in the order they were
   * made — which is the order the audience sees them in.
   */
  const recordPose = useCallback(
    (layerId: string, x: number, y: number, at: number) => {
      const stamp = clamp(Number(at.toFixed(3)), 0, Math.max(0, animationDuration(anim) - 0.001))
      setAnim((prev) => {
        const current = prev.layers.find((l) => l.id === layerId)
        if (!current) return prev
        const keyed: AnimLayer = { ...current, mode: 'key' }
        const withX = withKey(keyed, 'x', stamp, lookupOf(prev), { v: round(x, 2) })
        const withY = withKey(withX, 'y', stamp, lookupOf(prev), { v: round(y, 2) })
        // A layer that never had a size track draws at the default 6 units,
        // which swallows the whole plot; give it a sane one up front.
        const sized = withY.tracks.size?.length ? withY : { ...withY, tracks: { ...withY.tracks, size: [newKey(0, 0.8), newKey(0.01, 0.8)] } }
        past.current.push(prev)
        if (past.current.length > 80) past.current.shift()
        future.current = []
        setDirty(true)
        setHistory({ canUndo: true, canRedo: false })
        return { ...prev, layers: prev.layers.map((l) => (l.id === layerId ? sized : l)) }
      })
    },
    [anim],
  )

  /** Live feedback while the pointer is down: move the object, write nothing. */
  const previewPose = useCallback((layerId: string, x: number, y: number, at: number) => {
    setAnim((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => {
        if (l.id !== layerId) return l
        const tracks = { ...l.tracks }
        // An ephemeral track keeps the drag visible without polluting undo
        // history; the real keyframes are written on release.
        tracks.x = [...(tracks.x ?? []).filter((k) => Math.abs(k.t - at) > 1e-4), newKey(at, round(x, 2), 'linear')]
        tracks.y = [...(tracks.y ?? []).filter((k) => Math.abs(k.t - at) > 1e-4), newKey(at, round(y, 2), 'linear')]
        if (!tracks.size?.length) tracks.size = [newKey(0, 0.8, 'linear')]
        return { ...l, mode: 'key', tracks }
      }),
    }))
  }, [])

  /** One beat forward, wrapping so a take can be looped and re-shot. */
  const advance = useCallback(() => {
    setT((prev) => {
      const next = Number((prev + beat).toFixed(3))
      return next >= duration ? 0 : next
    })
  }, [beat, duration])

  /** Click-to-add a point on the selected layer's path. */
  const appendPathPoint = useCallback((layerId: string, x: number, y: number) => {
    setAnim((prev) => {
      const next = prev.layers.map((l) => {
        if (l.id !== layerId) return l
        const path = l.path ?? { points: [] }
        const points = [...path.points, { x: round(x, 2), y: round(y, 2) }]
        // Clicking back on the first point closes the loop — the gesture every
        // drawing tool uses, and the one people already expect here.
        const first = path.points[0]
        const closed = path.closed || (!!first && points.length > 3 && Math.hypot(x - first.x, y - first.y) * sceneUnit(prev) < 12)
        return { ...l, mode: 'path' as const, path: { ...path, points, closed } }
      })
      return { ...prev, layers: next }
    })
    setDirty(true)
  }, [])

  /** Wipe the recorded keys of the selected layer back to an empty stage. */
  const clearTake = useCallback(() => {
    if (!layer) return
    const emptied: AnimLayer = { ...layer, mode: 'key', tracks: {} }
    patchLayer(emptied)
    setT(0)
  }, [layer, patchLayer])

  /** Store every layer's current pose — for "capture the whole stage". */
  const recordAll = useCallback(() => {
    setAnim((prev) => {
      const stamp = clamp(Number(t.toFixed(3)), 0, Math.max(0, animationDuration(prev) - 0.001))
      const lookup = lookupOf(prev)
      const layers = prev.layers.map((l) => {
        if (!l.visible) return l
        const pos = layerPos(l, stamp, lookup)
        const keyed: AnimLayer = { ...l, mode: 'key' }
        const withX = withKey(keyed, 'x', stamp, lookup, { v: round(pos.x, 2) })
        const withY = withKey(withX, 'y', stamp, lookup, { v: round(pos.y, 2) })
        const sized = withY.tracks.size?.length ? withY : { ...withY, tracks: { ...withY.tracks, size: [newKey(0, 0.8), newKey(0.01, 0.8)] } }
        return sized
      })
      past.current.push(prev)
      future.current = []
      setDirty(true)
      setHistory({ canUndo: true, canRedo: false })
      return { ...prev, layers }
    })
  }, [t])

  const addKeyAt = useCallback(
    (prop: AnimProp) => {
      if (!layer) return
      const next = withKey(layer, prop, t)
      patchLayer(next)
      const keys = next.tracks[prop] ?? []
      const hit = keys.find((k) => Math.abs(k.t - t) < 1e-3)
      if (hit) setSelectedKey({ layerId: layer.id, prop, keyId: hit.id })
    },
    [layer, t, patchLayer],
  )

  const deleteSelectedKey = useCallback(() => {
    if (!selectedKey) return
    const l = anim.layers.find((x) => x.id === selectedKey.layerId)
    if (!l) return
    patchLayer(withoutKey(l, selectedKey.prop as AnimProp, selectedKey.keyId))
    setSelectedKey(null)
  }, [selectedKey, anim.layers, patchLayer])

  const moveKey = useCallback(
    (layerId: string, prop: string, keyId: string, time: number) => {
      const l = anim.layers.find((x) => x.id === layerId)
      if (!l) return
      const p = prop as AnimProp
      const keys = l.tracks[p] ?? []
      // If the key belongs to x/y of a merged "position" row, locate it in both.
      const source = keys.find((k) => k.id === keyId) ? p : ANIM_PROPS.find((q) => (l.tracks[q] ?? []).some((k) => k.id === keyId))
      if (!source) return
      const hit = (l.tracks[source] ?? []).find((k) => k.id === keyId)
      if (!hit) return
      patchLayer(withKey(l, source, hit.t, undefined, { t: time }))
    },
    [anim.layers, patchLayer],
  )

  const selectKey = useCallback((layerId: string, prop: string, keyId: string) => {
    setSelectedKey({ layerId, prop, keyId })
    setSelectedLayerId(layerId)
    setTarget({ kind: 'layer', id: layerId })
  }, [])

  /* ---- keyboard ---- */
  const keyTimes = useMemo(() => allKeyframes(anim).map((k) => k.t), [anim])

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      // Text entry owns the keyboard. A focused slider still gets everything
      // except the arrow keys, which belong to the slider itself.
      const isRange = tag === 'INPUT' && (el as HTMLInputElement).type === 'range'
      if (tag === 'TEXTAREA' || tag === 'SELECT') return
      if (tag === 'INPUT' && !isRange) return
      if (isRange && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      // A focused timeline keyframe owns the arrow keys.
      if (tag === 'BUTTON' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      switch (e.key) {
        case ' ':
          e.preventDefault()
          setPlaying((p) => !p)
          break
        case 'ArrowLeft':
          e.preventDefault()
          e.stopPropagation()
          seek(t + (e.shiftKey ? 0.5 : timeSnap || 0.05))
          break
        case 'ArrowRight':
          e.preventDefault()
          e.stopPropagation()
          seek(t - (e.shiftKey ? 0.5 : timeSnap || 0.05))
          break
        case 'Home':
          e.preventDefault()
          seek(0)
          break
        case 'End':
          e.preventDefault()
          seek(duration)
          break
        case ',':
        case 'ArrowDown': {
          e.preventDefault()
          const prev = [...keyTimes].reverse().find((x) => x < t - 1e-4)
          seek(prev ?? 0)
          break
        }
        case '.':
        case 'ArrowUp': {
          e.preventDefault()
          const next = keyTimes.find((x) => x > t + 1e-4)
          seek(next ?? duration)
          break
        }
        case 'r':
        case 'R':
          e.preventDefault()
          setPlaying(false)
          setRecording((r) => !r)
          break
        case 'k':
        case 'K':
          e.preventDefault()
          addKeyAt('x')
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          deleteSelectedKey()
          break
        case '?':
          e.preventDefault()
          setShowHelp(true)
          break
        default:
          if (/^[1-9]$/.test(e.key)) {
            const l = anim.layers[Number(e.key) - 1]
            if (l) {
              setSelectedLayerId(l.id)
              setTarget({ kind: 'layer', id: l.id })
            }
          }
      }
    },
    [t, duration, timeSnap, keyTimes, addKeyAt, deleteSelectedKey, undo, redo, seek, anim.layers],
  )
  const keysRef = useLocalKeys(onKey, [onKey])
  // The drag callbacks run from pointer events, so they read these refs rather
  // than closing over state that would go stale mid-gesture.
  const selectedLayerIdRef = useRef<string | null>(selectedLayerId)
  const tRef = useRef(t)
  useEffect(() => {
    selectedLayerIdRef.current = selectedLayerId
    tRef.current = t
  }, [selectedLayerId, t])

  /* ---- derived warnings ---- */
  const extent = keyframeExtent(anim)
  const overrun = extent > duration + 1e-6

  const stats = useMemo(
    () => ({ layers: anim.layers.length, series: anim.series.filter((s) => s.visible).length, keys: allKeyframes(anim).length }),
    [anim],
  )

  const applyPreset = (build: () => Animation) => {
    const next = build()
    setAnim(next)
    setTitle(next.title)
    setSelectedLayerId(next.layers[0]?.id ?? null)
    setTarget(next.layers.length > 0 ? { kind: 'layer', id: next.layers[0].id } : next.series.length > 0 ? { kind: 'series', id: next.series[0].id } : { kind: 'scene' })
    setT(0)
    setPlaying(true)
    past.current = []
    future.current = []
    setDirty(true)
    setHistory({ canUndo: false, canRedo: false })
    setShowPresets(false)
    toast('الگو اعمال شد')
  }

  const head = (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-hairline bg-surface/95 px-3 py-2 backdrop-blur">
      <button
        type="button"
        onClick={() => {
          commit()
          navigate(`/create?slide=${located?.slide.id ?? ''}`)
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-hairline bg-surface px-3 text-xs font-bold text-ink-2 transition hover:bg-sunken hover:text-ink"
      >
        <ArrowRight className="size-3.5" />
        بازگشت به استودیو
      </button>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          setDirty(true)
        }}
        aria-label="عنوان انیمیشن"
        className="min-w-40 max-w-xs flex-1 rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-sm font-black text-ink outline-none transition hover:bg-sunken focus:border-brand/60 focus:bg-surface"
      />

      <Badge tone={dirty ? 'brand' : 'ok'} icon={dirty ? CircleDot : undefined}>
        {dirty ? 'ذخیره خودکار…' : 'ذخیره شد'}
      </Badge>

      <div className="ms-auto flex items-center gap-1.5">
        <IconButton icon={Undo2} label="واگرد (Ctrl+Z)" size="sm" disabled={!history.canUndo} onClick={undo} />
        <IconButton icon={Redo2} label="ازنو (Ctrl+Shift+Z)" size="sm" disabled={!history.canRedo} onClick={redo} />
        <Button size="sm" variant="outline" icon={Sparkles} onClick={() => setShowPresets(true)}>
          الگوها
        </Button>
        <IconButton icon={Keyboard} label="کلیدهای میان‌بر" size="sm" onClick={() => setShowHelp(true)} />
        <Button size="sm" variant="primary" onClick={() => { commit(); toast('ذخیره شد ✓') }}>
          ذخیره
        </Button>
      </div>
    </header>
  )

  if (!pres || !located || !original || original.kind !== 'animation') {
    return (
      <div className="min-h-screen bg-canvas font-vazir">
          {head}
        <div className="p-6">
          <Empty
            icon={Sparkles}
            title="این انیمیشن پیدا نشد"
            body="ممکن است کادر حذف یا جابه‌جا شده باشد."
            action={
              <Button variant="primary" onClick={() => navigate('/create')}>
                بازگشت به ویرایشگر
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div ref={keysRef} className="flex min-h-screen flex-col bg-canvas font-vazir" tabIndex={-1}>
      {head}

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[15rem_1fr_20rem]">
        {/* ---------- left: object list ---------- */}
        <aside className="order-2 flex min-h-0 flex-col gap-3 lg:order-1">
          <div className="surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
              <Layers className="size-3.5 text-ink-3" />
              <h2 className="text-2xs font-black uppercase tracking-wide text-ink-3">جسم‌ها</h2>
              <span className="ms-auto text-2xs tabular-nums text-ink-3">{toFaDigits(stats.layers)}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto scroll-thin p-2">
              {anim.layers.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setSelectedLayerId(l.id)
                    setTarget({ kind: 'layer', id: l.id })
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-start transition',
                    selectedLayerId === l.id ? 'border-brand/60 bg-brand-soft/60' : 'border-transparent hover:bg-sunken',
                  )}
                >
                  <kbd className="kbd shrink-0">{toFaDigits(i + 1)}</kbd>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-2">{l.name || 'بی‌نام'}</span>
                  <span className="shrink-0 text-2xs text-ink-3">
                    {l.mode === 'key' ? 'کی‌فریم' : l.mode === 'expr' ? 'فرمول' : 'روی نمودار'}
                  </span>
                </button>
              ))}
              <AddLayerButton colorIndex={anim.layers.length} onAdd={(l) => { patch({ ...anim, layers: [...anim.layers, l] }); setSelectedLayerId(l.id); setTarget({ kind: 'layer', id: l.id }) }} />
            </div>
          </div>

          <div className="surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
              <LineChart className="size-3.5 text-ink-3" />
              <h2 className="text-2xs font-black uppercase tracking-wide text-ink-3">منحنی‌ها</h2>
              <span className="ms-auto text-2xs tabular-nums text-ink-3">{toFaDigits(stats.series)}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto scroll-thin p-2">
              {anim.series.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTarget({ kind: 'series', id: s.id })}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-start transition',
                    target.kind === 'series' && target.id === s.id ? 'border-brand/60 bg-brand-soft/60' : 'border-transparent hover:bg-sunken',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-ink-2" dir="ltr">
                    {s.label || s.expr}
                  </span>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="shrink-0 text-2xs tabular-nums text-ink-3">{toFaDigits(i + 1)}</span>
                </button>
              ))}
              <AddSeriesButton onAdd={(s) => { patch({ ...anim, series: [...anim.series, s] }); setTarget({ kind: 'series', id: s.id }) }} />
            </div>
          </div>
        </aside>

        {/* ---------- centre: stage + transport + timeline ---------- */}
        <main className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          {recording && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-danger/40 bg-danger/[0.06] px-3 py-2 text-2xs font-bold text-ink-2">
              <span className="flex items-center gap-1.5 text-danger">
                <CircleDot className="size-3.5 animate-pulse" />
                ضبط
              </span>
              <span>
                جسم را <span className="font-black">بکشید و رها کنید</span>؛ هر حرکت یک کی‌فریم در همین ثانیه می‌شود و
                ساعت یک ضرب جلو می‌رود.
              </span>
              <span className="ms-auto flex items-center gap-1.5">
                <Button size="xs" variant="subtle" icon={Camera} onClick={recordAll}>
                  ثبت وضعیت همهٔ اجسام
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  icon={SkipForward}
                  onClick={() => seek(Math.min(duration, Number((t + beat).toFixed(3))))}
                >
                  ضرب بعدی
                </Button>
                <Button size="xs" variant="subtle" icon={Eraser} onClick={clearTake}>
                  پاک کردن
                </Button>
                <Button size="xs" variant="danger" icon={Square} onClick={() => setRecording(false)}>
                  پایان ضبط
                </Button>
              </span>
            </div>
          )}

          <div className="surface min-w-0 flex-1 overflow-hidden rounded-2xl p-3">
            <AnimationScene
              anim={anim}
              t={t}
              onScrub={seek}
              fallbackLayerId={recording ? selectedLayerId : null}
              pathDraw={pathDraw}
              drag={
                recording || pathDraw
                  ? {
                      onGrab: (id) => {
                        setSelectedLayerId(id)
                        setTarget({ kind: 'layer', id })
                      },
                      onMove: (x, y) => {
                        const id = selectedLayerIdRef.current
                        if (id) previewPose(id, x, y, tRef.current)
                      },
                      onRelease: (x, y) => {
                        const id = selectedLayerIdRef.current
                        if (!id) return
                        recordPose(id, x, y, tRef.current)
                        advance()
                      },
                      onTap: (x, y) => {
                        // In path mode a click adds a point instead of moving
                        // the object: drawing a loop by hand beats typing
                        // coordinates, and beats two formulas for x and y.
                        const id = selectedLayerIdRef.current
                        if (!id) return
                        appendPathPoint(id, x, y)
                      },
                    }
                  : undefined
              }
              highlightLayerId={recording ? selectedLayerId : null}
            />
          </div>

          <div className="surface flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
            <IconButton
              icon={Spline}
              label={pathDraw ? 'پایان رسم مسیر' : 'رسم مسیر (کلیک روی صحنه)'}
              size="sm"
              active={pathDraw}
              onClick={() => setPathDraw((v) => !v)}
            />
            <IconButton
              icon={CircleDot}
              label={recording ? 'پایان ضبط' : 'حالت ضبط (R)'}
              size="sm"
              active={recording}
              variant={recording ? 'danger' : undefined}
              onClick={() => {
                setRecording((r) => {
                  const next = !r
                  if (next) setPlaying(false)
                  return next
                })
              }}
            />
            <IconButton icon={playing ? Pause : Play} label={playing ? 'مکث' : 'پخش'} onClick={() => setPlaying((p) => !p)} />
            <IconButton icon={RotateCcw} label="از اول" size="sm" onClick={() => { seek(0); setPlaying(true) }} />
            <IconButton icon={SkipBack} label="یک قاب عقب" size="sm" onClick={() => seek(t - (timeSnap || 0.05))} />
            <IconButton icon={SkipForward} label="یک قاب جلو" size="sm" onClick={() => seek(t + (timeSnap || 0.05))} />

            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={t}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="زمان"
              className="h-1.5 min-w-24 flex-1 cursor-pointer appearance-none rounded-full"
              style={{
                backgroundImage: `linear-gradient(to left, rgb(var(--brand)) ${(t / duration) * 100}%, rgb(var(--line)) ${(t / duration) * 100}%)`,
              }}
            />

            <span className="shrink-0 text-xs font-black tabular-nums text-ink-2">
              {toFaDigits(t.toFixed(2))} / {toFaDigits(duration.toFixed(2))} ث
            </span>

            {recording && (
              <span className="flex items-center gap-1 rounded-xl bg-sunken px-2 py-1">
                <span className="text-2xs font-bold text-ink-3">ضرب</span>
                <NumInput value={beat} step={0.25} min={0.05} suffix="ث" onChange={setBeat} />
              </span>
            )}

            <Segmented
              size="sm"
              label="سرعت پخش"
              value={String(speedScale)}
              onChange={(v) => setSpeedScale(Number(v))}
              options={[
                { value: '0.25', label: '¼×' },
                { value: '0.5', label: '½×' },
                { value: '1', label: '۱×' },
                { value: '2', label: '۲×' },
              ]}
            />
          </div>

          {overrun && (
            <div className="flex items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-2xs font-bold text-warn">
              <MousePointerClick className="size-3.5" />
              آخرین کی‌فریم تا {toFaDigits(extent.toFixed(2))} ثانیه است ولی مدت انیمیشن {toFaDigits(duration.toFixed(2))} ثانیه — بخشی از حرکت دیده نمی‌شود.
            </div>
          )}

          <Timeline
            anim={anim}
            t={t}
            onSeek={seek}
            selectedLayerId={selectedLayerId}
            onSelectLayer={(id) => {
              setSelectedLayerId(id)
              setTarget({ kind: 'layer', id })
            }}
            onMoveKey={moveKey}
            onSelectKey={selectKey}
            selectedKeyId={selectedKey?.keyId ?? null}
            onDeleteKey={deleteSelectedKey}
            timeSnap={timeSnap}
            onTimeSnapChange={setTimeSnap}
          />
        </main>

        {/* ---------- right: inspector ---------- */}
        <aside className="order-3 min-h-0 overflow-hidden rounded-2xl border border-hairline bg-surface">
          <div className="flex items-center gap-1 border-b border-hairline p-1">
            <Segmented
              size="sm"
              label="پنل"
              className="flex-1"
              value={target.kind}
              onChange={(v) => {
                if (v === 'scene') setTarget({ kind: 'scene' })
                else if (v === 'layer') setTarget({ kind: 'layer', id: selectedLayerId ?? '' })
                else setTarget({ kind: 'series', id: anim.series[0]?.id ?? '' })
              }}
              options={[
                { value: 'layer', label: `جسم${anim.layers.length ? '' : ' ·۰'}` },
                { value: 'series', label: `منحنی${anim.series.length ? '' : ' ·۰'}` },
                { value: 'scene', label: 'صحنه' },
              ]}
            />
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto scroll-thin">
            {target.kind === 'layer' && layer && (
              <LayerInspector layer={layer} anim={anim} t={t} onChange={patchLayer} onRemove={() => {
                const layers = anim.layers.filter((l) => l.id !== layer.id)
                patch({ ...anim, layers })
                setSelectedLayerId(layers[0]?.id ?? null)
                if (layers.length === 0) setTarget({ kind: 'scene' })
              }} />
            )}
            {target.kind === 'layer' && !layer && (
              <div className="space-y-3 p-3">
                <Empty
                  icon={Layers}
                  title="هنوز جسمی ندارید"
                  body="یک جسم اضافه کنید تا با فرمول یا کی‌فریم حرکت کند."
                />
                <AddLayerButton
                  colorIndex={anim.layers.length}
                  onAdd={(l) => {
                    patch({ ...anim, layers: [...anim.layers, l] })
                    setSelectedLayerId(l.id)
                    setTarget({ kind: 'layer', id: l.id })
                  }}
                />
              </div>
            )}
            {target.kind === 'series' && series && (
              <SeriesInspector
              series={series}
              index={anim.series.findIndex((s) => s.id === series.id)}
              t={t}
              panelOptions={scenePanels(anim).filter((p) => p.id)}
              onChange={patchSeries}
              onRemove={() => {
                const rest = anim.series.filter((s) => s.id !== series.id)
                patch({ ...anim, series: rest })
                if (rest.length === 0) setTarget({ kind: 'scene' })
              }} />
            )}
            {target.kind === 'series' && !series && (
              <div className="space-y-3 p-3">
                <Empty
                  icon={LineChart}
                  title="هنوز منحنی‌ای ندارید"
                  body="یک منحنی اضافه کنید تا روی محور زمان رسم شود."
                />
                <AddSeriesButton
                  onAdd={(sr) => {
                    patch({ ...anim, series: [...anim.series, sr] })
                    setTarget({ kind: 'series', id: sr.id })
                  }}
                />
              </div>
            )}
            {target.kind === 'scene' && <SceneInspector anim={anim} onChange={patch} />}
          </div>
        </aside>
      </div>

      {/* ---------- presets ---------- */}
      <Modal open={showPresets} onClose={() => setShowPresets(false)} title="الگوهای آماده" size="lg">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.build)}
              className="group flex flex-col items-start gap-1 rounded-2xl border border-hairline bg-surface p-3 text-start transition hover:border-brand/60 hover:bg-soft"
            >
              <span className="flex w-full items-center gap-1.5 text-xs font-black text-ink">
                <CircleDot className="size-3.5 text-brand" />
                {p.label}
              </span>
              <span className="text-2xs leading-5 text-ink-3">{p.blurb}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* ---------- shortcuts ---------- */}
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="کلیدهای میان‌بر استودیو" size="md">
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ['Space', 'پخش / مکث'],
            ['← →', 'حرکت زمان (Shift = گام بزرگ)'],
            ['↑ ↓ یا . ,', 'رفتن به کی‌فریم قبلی/بعدی'],
            ['Home / End', 'ابتدا / انتهای انیمیشن'],
            ['K', 'ثبت کی‌فریم در لحظهٔ فعلی'],
            ['Delete', 'حذف کی‌فریم انتخاب‌شده'],
            ['1 … 9', 'انتخاب جسم n'],
            ['Ctrl+Z', 'واگرد'],
            ['?', 'همین راهنما'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 rounded-xl bg-sunken/70 px-3 py-2">
              <dt className="shrink-0">
                <kbd className="kbd">{k}</kbd>
              </dt>
              <dd className="text-xs font-bold text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-2xs leading-6 text-ink-3">
          کی‌فریم‌ها را می‌توانید با ماوس بکشید یا با کلیدهای جهت‌دار جابه‌جا کنید؛ برای حذف روی آن‌ها
          <kbd className="kbd mx-1">Tab</kbd>
          کنید و <kbd className="kbd">Delete</kbd> بزنید.
        </p>
      </Modal>

      <Confirm
        open={confirmDiscard}
        title="تغییرات ذخیره شود؟"
        body="پیش از بازگشت، انیمیشن در ارائه ذخیره می‌شود."
        tone="brand"
        confirmLabel="ذخیره و بازگشت"
        cancelLabel="بازگشت بدون ذخیره"
        onConfirm={() => {
          commit()
          setConfirmDiscard(false)
          navigate(`/create?slide=${located.slide.id}`)
        }}
        onCancel={() => {
          setConfirmDiscard(false)
          navigate(`/create?slide=${located.slide.id}`)
        }}
      />

      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="pointer-events-none fixed bottom-2 start-2 z-20 hidden lg:block"
      >
        <span className="rounded-full border border-hairline bg-surface/80 px-2.5 py-1 text-2xs font-bold text-ink-3 backdrop-blur">
          {toFaDigits(stats.keys)} کی‌فریم · {toFaDigits(duration.toFixed(1))} ثانیه
        </span>
      </motion.div>
    </div>
  )
}
