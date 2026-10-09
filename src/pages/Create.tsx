import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookMarked,
  Copy,
  Download,
  Eye,
  Gauge,
  Keyboard,
  Library,
  MonitorPlay,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import type { BankQuestion, Presentation, PresentationTheme, Slide, SlideStep, StepKind } from '../types'
import {
  KIND_LABEL,
  THEME_LABEL,
  blankPresentation,
  defaultSpanFor,
  emptyQuestion,
  emptySlide,
  emptyStep,
  uid,
} from '../types'
import {
  copyPresentation,
  ingestPresentations,
  putPresentation,
  putQuestion,
  removePresentation,
  usePresentations,
  useQuestions,
} from '../lib/store'
import { downloadJSON, safeFilename } from '../storage'
import { spanClass, spanCols } from '../lib/span'
import { cn, moveItem, toFaDigits } from '../lib/utils'
import { HELP_COMBOS, useHotkeys } from '../lib/hotkeys'
import { StepView } from '../components/blocks'
import { BLOCK_KINDS, BLOCK_META } from '../components/blocks'
import { BlockCard } from '../components/editor/BlockCard'
import { Badge, Button, Empty, Field, IconButton, Input, Segmented, Select } from '../components/ui/primitives'
import { Confirm, Menu, Modal, Toasts, toast, type MenuItem } from '../components/ui/overlay'
import { ShortcutsSheet } from '../components/ui/ShortcutsSheet'
import { CommandPalette, type Command } from '../components/ui/CommandPalette'
import { QuestionPicker } from '../components/bank/QuestionPicker'
import { QuestionEditor } from '../components/bank/QuestionEditor'
import { samplePresentation, seedQuestionBank } from '../sample'
import { kinematicsLesson } from '../lessons/kinematics'
import { DragHandle, SortableGrid, SortableList } from '../components/dnd/Sortable'

/** A bank question becomes a quiz block that keeps a live link to its source. */
function toQuizStep(q: BankQuestion): SlideStep {
  return {
    id: uid('step'),
    span: 'full',
    kind: 'quiz',
    question: q.stem,
    options: [...q.options],
    answerIndex: q.answerIndex,
    explanation: q.explanation,
    bankId: q.id,
  }
}

export default function Create() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const library = usePresentations()
  const questions = useQuestions()

  const [activeId, setActiveId] = useState<string>(() => library[0]?.id ?? '')
  const pres = library.find((p) => p.id === activeId)

  const [past, setPast] = useState<Presentation[]>([])
  const [future, setFuture] = useState<Presentation[]>([])
  const [historyTick, setHistoryTick] = useState(0)

  const [railQuery, setRailQuery] = useState('')
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'recent'>('all')
  const [drawer, setDrawer] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Presentation | null>(null)
  const [renaming, setRenaming] = useState<Presentation | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [help, setHelp] = useState(false)
  const [palette, setPalette] = useState(false)
  const [picker, setPicker] = useState<{ slideId: string; index: number } | null>(null)
  const [creating, setCreating] = useState<{ seed: string; slideId: string; index: number } | null>(null)

  /* ---------------- mutation with history ---------------- */

  const patch = useCallback(
    (fn: (p: Presentation) => Presentation) => {
      if (!pres) return
      const next = fn(pres)
      setPast((x) => [...x.slice(-79), pres])
      setFuture([])
      putPresentation(next)
      setHistoryTick((x) => x + 1)
    },
    [pres],
  )

  const undo = useCallback(() => {
    if (!pres) return
    const prev = past[past.length - 1]
    if (!prev) return
    setPast((x) => x.slice(0, -1))
    setFuture((x) => [...x, pres])
    putPresentation(prev)
    setHistoryTick((x) => x + 1)
  }, [past, pres])

  const redo = useCallback(() => {
    if (!pres) return
    const next = future[future.length - 1]
    if (!next) return
    setFuture((x) => x.slice(0, -1))
    setPast((x) => [...x, pres])
    putPresentation(next)
    setHistoryTick((x) => x + 1)
  }, [future, pres])

  void historyTick

  const createDeck = useCallback(() => {
    const fresh = blankPresentation()
    putPresentation(fresh)
    setActiveId(fresh.id)
    return fresh
  }, [])

  /* ---------------- slide ops ---------------- */

  const updateSlide = useCallback(
    (slideId: string, fn: (s: Slide) => Slide) =>
      patch((p) => ({ ...p, slides: p.slides.map((s) => (s.id === slideId ? fn(s) : s)) })),
    [patch],
  )

  const addSlide = useCallback(() => {
    const deck = pres ?? createDeck()
    if (!deck) return
    patch((p) => ({ ...p, slides: [...p.slides, emptySlide(p.slides.length + 1)] }))
  }, [pres, createDeck, patch])

  const duplicateSlide = (slideId: string) =>
    patch((p) => ({
      ...p,
      slides: p.slides.flatMap((s) =>
        s.id === slideId
          ? [
              s,
              {
                ...structuredClone(s),
                id: uid('slide'),
                title: `${s.title} (کپی)`,
                steps: s.steps.map((x) => ({ ...structuredClone(x), id: uid('step') })),
              },
            ]
          : [s],
      ),
    }))

  const removeSlide = (slideId: string) => patch((p) => ({ ...p, slides: p.slides.filter((s) => s.id !== slideId) }))

  const reorderSlides = (from: number, to: number) => patch((p) => ({ ...p, slides: moveItem(p.slides, from, to) }))

  /* ---------------- block ops ---------------- */

  const setStep = (slideId: string, index: number, step: SlideStep) =>
    updateSlide(slideId, (s) => ({ ...s, steps: s.steps.map((x, i) => (i === index ? step : x)) }))

  const addStep = useCallback(
    (slideId: string, kind: StepKind = 'text') =>
      updateSlide(slideId, (s) => ({ ...s, steps: [...s.steps, emptyStep(kind)] })),
    [updateSlide],
  )

  const removeStep = (slideId: string, index: number) =>
    updateSlide(slideId, (s) => ({ ...s, steps: s.steps.filter((_, i) => i !== index) }))

  const duplicateStep = (slideId: string, index: number) =>
    updateSlide(slideId, (s) => ({
      ...s,
      steps: s.steps.flatMap((x, i) => (i === index ? [x, { ...structuredClone(x), id: uid('step') }] : [x])),
    }))

  const moveStep = (slideId: string, index: number, dir: -1 | 1) =>
    updateSlide(slideId, (s) => {
      const j = index + dir
      if (j < 0 || j >= s.steps.length) return s
      return { ...s, steps: moveItem(s.steps, index, j) }
    })

  const reorderSteps = (slideId: string, from: number, to: number) =>
    updateSlide(slideId, (s) => ({ ...s, steps: moveItem(s.steps, from, to) }))

  const changeKind = (slideId: string, index: number, kind: StepKind) => {
    const current = pres?.slides.find((s) => s.id === slideId)?.steps[index]
    if (!current) return
    const fresh = emptyStep(kind)
    const carried = 'value' in current ? current.value : ''
    const next: SlideStep = carried && 'value' in fresh ? ({ ...fresh, value: carried } as SlideStep) : fresh
    setStep(slideId, index, { ...next, id: current.id, span: defaultSpanFor(kind) } as SlideStep)
  }

  const openPicker = useCallback(() => {
    const first = pres?.slides[0]
    if (!first) return
    setPicker({ slideId: first.id, index: Math.max(0, first.steps.length - 1) })
  }, [pres])

  /** Hidden file input, triggered from the toolbar and the palette alike. */
  const openImportDialog = useCallback(() => {
    document.getElementById('deck-import')?.click()
  }, [])

  const insertQuestion = (slideId: string, index: number, q: BankQuestion) => {
    putQuestion({ ...q, used: (q.used ?? 0) + 1 })
    setStep(slideId, index, toQuizStep(q))
    setPicker(null)
    toast('سؤال درج شد ✓', 'ok', { detail: q.tags.join(':') || 'بدون برچسب' })
  }

  /* ---------------- library ---------------- */

  const newDeck = useCallback(() => {
    createDeck()
    setDrawer(false)
  }, [createDeck])

  const requestDelete = useCallback((target: Presentation) => {
    setDrawer(false)
    setConfirmDelete(target)
  }, [])

  const requestRename = useCallback((target: Presentation) => {
    setDrawer(false)
    setRenaming(target)
    setRenameValue(target.title)
  }, [])

  const commitRename = useCallback(() => {
    if (!renaming) return
    const next = renameValue.trim()
    if (!next || next === renaming.title) {
      setRenaming(null)
      return
    }
    putPresentation({ ...renaming, title: next })
    setRenaming(null)
    toast('تغییر نام ذخیره شد ✓')
  }, [renaming, renameValue])

  const duplicateDeck = useCallback(() => {
    if (!pres) return
    const copy = copyPresentation(pres.id)
    if (copy) {
      setActiveId(copy.id)
      toast('کپی ساخته شد')
    }
  }, [pres])

  const filteredLibrary = useMemo(() => {
    const q = railQuery.trim()
    let list = library
    if (q) list = list.filter((p) => `${p.title} ${p.description ?? ''}`.includes(q))
    if (libraryFilter === 'recent') list = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }, [library, railQuery, libraryFilter])

  const stats = useMemo(() => {
    if (!pres) return { slides: 0, blocks: 0, quizzes: 0, anims: 0, mins: 0 }
    const all = pres.slides.flatMap((s) => s.steps)
    return {
      slides: pres.slides.length,
      blocks: all.length,
      quizzes: all.filter((s) => s.kind === 'quiz').length,
      anims: all.filter((s) => s.kind === 'animation').length,
      mins: Math.max(2, Math.round(all.length * 0.8)),
    }
  }, [pres])

  /* ---------------- navigation helpers ---------------- */

  const findLastAnimation = useCallback(() => {
    if (!pres) return null
    for (let si = pres.slides.length - 1; si >= 0; si -= 1) {
      for (let i = pres.slides[si].steps.length - 1; i >= 0; i -= 1) {
        if (pres.slides[si].steps[i].kind === 'animation') return { slideId: pres.slides[si].id, index: i }
      }
    }
    return null
  }, [pres])

  const openStudio = useCallback(() => {
    const found = findLastAnimation()
    if (!found || !pres) return
    const step = pres.slides.find((s) => s.id === found.slideId)?.steps[found.index]
    navigate(`/studio/${pres.id}/${found.slideId}/${step?.id ?? 'x'}`)
  }, [findLastAnimation, pres, navigate])

  const loadSample = useCallback(() => {
    const sample = samplePresentation()
    putPresentation(sample)
    setActiveId(sample.id)
    toast('نمونه بارگذاری شد ✓')
  }, [])

  const loadLesson = useCallback(() => {
    const deck = kinematicsLesson()
    putPresentation(deck)
    setActiveId(deck.id)
    toast('درس حرکت‌شناسی آماده شد ✓', 'ok', {
      detail: `${toFaDigits(deck.slides.length)} بخش با انیمیشن‌های زنده`,
    })
  }, [])

  const seedBank = useCallback(() => {
    const seeded = seedQuestionBank()
    for (const q of seeded) putQuestion(q)
    toast(`${toFaDigits(seeded.length)} سؤال به بانک اضافه شد ✓`)
  }, [])

  /* ---------------- deep link: ?slide=… ---------------- */
  useEffect(() => {
    const want = params.get('slide')
    if (!want) return
    document.getElementById(`slide-${want}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    const next = new URLSearchParams(params)
    next.delete('slide')
    setParams(next, { replace: true })
  }, [params, setParams])

  /* ---------------- keyboard ---------------- */
  useHotkeys(
    [
      { id: 'palette', combo: 'mod+k', label: 'جعبه‌فرمان', group: 'عمومی', priority: 10, run: () => setPalette(true) },
      ...HELP_COMBOS.map((combo) => ({
        id: `help-${combo}`,
        combo,
        label: 'کلیدهای میان‌بر',
        group: 'عمومی',
        run: () => setHelp(true),
      })),
      { id: 'save', combo: 'mod+s', label: 'ذخیره', group: 'عمومی', run: () => toast('همه‌چیز خودکار ذخیره می‌شود ✓') },
      {
        id: 'insert-q',
        combo: 'mod+shift+q',
        label: 'درج سؤال از بانک',
        group: 'بانک سؤال',
        run: openPicker,
      },
      { id: 'bank', combo: 'mod+b', label: 'بانک سؤال', group: 'بانک سؤال', run: () => navigate('/bank') },
      {
        id: 'present',
        combo: 'mod+enter',
        label: 'اجرای ارائه',
        group: 'نمایش',
        run: () => pres && navigate(`/view/${pres.id}`),
      },
      { id: 'studio', combo: 'mod+shift+a', label: 'استودیوی انیمیشن', group: 'نمایش', run: openStudio },
      { id: 'undo', combo: 'mod+z', label: 'واگرد', group: 'ویرایش', run: undo },
      { id: 'redo', combo: 'mod+shift+z', label: 'ازنو', group: 'ویرایش', run: redo },
      { id: 'redo-alt', combo: 'mod+y', label: 'ازنو', group: 'ویرایش', hidden: true, run: redo },
      { id: 'new-slide', combo: 'mod+shift+n', label: 'بخش تازه', group: 'ساختار', run: addSlide },
      { id: 'settings', combo: 'mod+,', label: 'تنظیمات ارائه', group: 'عمومی', run: () => setSettings(true) },
    ],
    [undo, redo, addSlide, openStudio, openPicker, pres, navigate],
  )

  /* ---------------- command palette ---------------- */
  const commands: Command[] = useMemo(() => {
    const list: Command[] = [
      { id: 'save', label: 'ذخیرهٔ ارائه', group: 'ارائه', hint: 'Ctrl+S', icon: <Save className="size-4" />, run: () => toast('ذخیره شد ✓') },
      { id: 'present', label: 'اجرای ارائه', group: 'نمایش', hint: 'Ctrl+↵', icon: <MonitorPlay className="size-4" />, run: () => pres && navigate(`/view/${pres.id}`) },
      { id: 'new', label: 'ارائهٔ تازه', group: 'ارائه', icon: <Plus className="size-4" />, run: newDeck },
      { id: 'dup', label: 'تکثیر ارائه', group: 'ارائه', icon: <Copy className="size-4" />, run: duplicateDeck },
      { id: 'rename', label: 'تغییر نام ارائه', group: 'ارائه', icon: <Pencil className="size-4" />, run: () => pres && requestRename(pres) },
      { id: 'del', label: 'حذف ارائه', group: 'ارائه', icon: <Trash2 className="size-4" />, run: () => pres && requestDelete(pres), disabled: !pres },
      { id: 'slide', label: 'افزودن بخش', group: 'ساختار', hint: 'Ctrl+Shift+N', icon: <Plus className="size-4" />, run: addSlide },
      { id: 'studio', label: 'باز کردن استودیوی انیمیشن', group: 'کادر', hint: 'Ctrl+Shift+A', icon: <Gauge className="size-4" />, run: openStudio, disabled: !findLastAnimation() },
      { id: 'bank', label: 'رفتن به بانک سؤال', group: 'بانک سؤال', hint: 'Ctrl+B', icon: <BookMarked className="size-4" />, run: () => navigate('/bank') },
      { id: 'insert', label: 'درج سؤال از بانک…', group: 'بانک سؤال', hint: 'Ctrl+Shift+Q', icon: <BookMarked className="size-4" />, run: openPicker },
      { id: 'settings', label: 'تنظیمات ارائه', group: 'ارائه', icon: <Settings2 className="size-4" />, run: () => setSettings(true) },
      { id: 'export', label: 'خروجی JSON این ارائه', group: 'فایل', icon: <Download className="size-4" />, run: () => pres && downloadJSON(pres, safeFilename(pres.title)) },
      { id: 'export-all', label: 'خروجی JSON همهٔ ارائه‌ها', group: 'فایل', icon: <Download className="size-4" />, run: () => downloadJSON(library, 'presentations') },
      { id: 'import', label: 'ورودی JSON…', group: 'فایل', icon: <Upload className="size-4" />, run: openImportDialog },
      {
        id: 'lesson',
        label: 'درس کامل حرکت‌شناسی (با انیمیشن)',
        group: 'نمونه',
        icon: <BookMarked className="size-4" />,
        run: loadLesson,
      },
      { id: 'sample', label: 'بارگذاری نمونهٔ فیزیک', group: 'نمونه', icon: <Sparkles className="size-4" />, run: loadSample },
      { id: 'seed', label: 'افزودن بانک سؤال نمونه', group: 'نمونه', icon: <Wand2 className="size-4" />, run: seedBank },
      { id: 'help', label: 'کلیدهای میان‌بر', group: 'راهنما', hint: '?', icon: <Keyboard className="size-4" />, run: () => setHelp(true) },
    ]
    if (pres) {
      for (const k of BLOCK_KINDS) {
        list.push({
          id: `add-${k}`,
          label: `افزودن کادر ${KIND_LABEL[k]} به بخش اول`,
          group: 'کادر',
          icon: <Plus className="size-4" />,
          run: () => {
            const slide = pres.slides[0]
            if (slide) addStep(slide.id, k)
          },
        })
      }
    }
    return list
  }, [
    pres,
    library,
    navigate,
    openStudio,
    findLastAnimation,
    openPicker,
    addSlide,
    addStep,
    loadSample,
    seedBank,
    duplicateDeck,
    newDeck,
    openImportDialog,
    requestDelete,
    requestRename,
    loadLesson,
  ])

  const handleImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const next = ingestPresentations(parsed)
        const first = Array.isArray(parsed) ? parsed[0] : parsed
        if (first?.id && next.some((p) => p.id === first.id)) setActiveId(first.id)
        toast('وارد شد ✓')
      } catch {
        toast('فایل JSON معتبر نیست', 'err')
      }
    }
    reader.readAsText(file)
  }

  /* ---------------- rail ---------------- */
  const rail = (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand">
          <Gauge className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-ink">استودیوی تدریس</p>
          <p className="text-2xs text-ink-3">{toFaDigits(library.length)} ارائه</p>
        </div>
        <IconButton icon={Plus} label="ارائهٔ تازه" size="sm" onClick={newDeck} />
      </div>

      <Input
        value={railQuery}
        onChange={(e) => setRailQuery(e.target.value)}
        placeholder="جست‌وجوی ارائه…"
        aria-label="جست‌وجوی ارائه"
        className="h-8 text-xs"
      />

      <Segmented
        size="sm"
        label="ترتیب کتابخانه"
        className="w-full"
        value={libraryFilter}
        onChange={setLibraryFilter}
        options={[
          { value: 'all', label: 'همه' },
          { value: 'recent', label: 'تازه‌ترین' },
        ]}
      />

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scroll-thin">
        {filteredLibrary.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-ink-3">ارائه‌ای نیست — یکی بسازید.</p>
        )}
        {filteredLibrary.map((p) => (
          <div
            key={p.id}
            className={`group flex items-center gap-1 rounded-xl border pr-1 transition ${
              p.id === activeId ? 'border-brand/60 bg-brand-soft/60' : 'border-hairline bg-surface hover:bg-sunken'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setActiveId(p.id)
                setDrawer(false)
              }}
              className="min-w-0 flex-1 px-2 py-2 text-start"
            >
              <span className="block truncate text-xs font-black text-ink">{p.title || 'بدون عنوان'}</span>
              <span className="mt-0.5 block text-2xs text-ink-3">
                {toFaDigits(p.slides.length)} بخش · {new Date(p.updatedAt).toLocaleDateString('fa-IR')}
              </span>
            </button>
            <Menu
              align="end"
              triggerSize="sm"
              menuWidth={210}
              label={`گزینه‌های «${p.title || 'بدون عنوان'}»`}
              icon={MoreHorizontal}
              items={
                [
                  {
                    type: 'item',
                    key: 'open',
                    label: 'باز کردن',
                    icon: <Pencil className="size-4" />,
                    disabled: p.id === activeId,
                    onSelect: () => setActiveId(p.id),
                  },
                  { type: 'item', key: 'rename', label: 'تغییر نام', icon: <Pencil className="size-4" />, onSelect: () => requestRename(p) },
                  { type: 'item', key: 'dup', label: 'تکثیر', icon: <Copy className="size-4" />, onSelect: () => {
                    const c = copyPresentation(p.id)
                    if (c) {
                      setActiveId(c.id)
                      toast('کپی ساخته شد ✓')
                    }
                  } },
                  { type: 'item', key: 'export', label: 'خروجی JSON', icon: <Download className="size-4" />, onSelect: () => downloadJSON(p, safeFilename(p.title)) },
                  { type: 'sep', key: 's' },
                  { type: 'item', key: 'del', label: 'حذف ارائه', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => requestDelete(p) },
                ] satisfies MenuItem[]
              }
            />
          </div>
        ))}
      </div>

      {/* slide order — draggable and keyboard-sortable */}
      {pres && pres.slides.length > 0 && (
        <div className="min-h-0 shrink-0 space-y-1 border-t border-hairline pt-2.5">
          <p className="px-1 text-2xs font-black uppercase tracking-wide text-ink-3">
            ترتیب بخش‌ها ({toFaDigits(pres.slides.length)})
          </p>
          <SortableList
            className="max-h-56 space-y-1 overflow-y-auto scroll-thin"
            label="ترتیب بخش‌ها"
            ids={pres.slides.map((s) => s.id)}
            onReorder={reorderSlides}
            renderRow={(id, index, drag) => {
              const slide = pres.slides.find((s) => s.id === id)
              if (!slide) return null
              return (
                <div
                  ref={drag.setNodeRef}
                  style={drag.style}
                  className={`flex items-center gap-1 rounded-lg border px-1 py-1 transition ${
                    drag.isDragging ? 'z-10 border-brand bg-surface shadow-lift' : 'border-transparent hover:bg-sunken'
                  }`}
                >
                  <DragHandle
                    listeners={drag.listeners}
                    attributes={drag.attributes}
                    setActivatorNodeRef={drag.setActivatorNodeRef}
                    label={`جابه‌جایی بخش ${toFaDigits(index + 1)}`}
                    compact
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById(`slide-${slide.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                    className="min-w-0 flex-1 text-start text-2xs font-bold text-ink-2"
                  >
                    <span className="ms-1 tabular-nums opacity-50">{toFaDigits(index + 1)}.</span>
                    {slide.title || 'بدون عنوان'}
                    <span className="ms-1.5 tabular-nums opacity-50">({toFaDigits(slide.steps.length)})</span>
                  </button>
                </div>
              )
            }}
            renderGhost={(id) => {
              const slide = pres.slides.find((s) => s.id === id)
              return (
                <div className="flex items-center gap-2 rounded-xl border border-brand bg-surface px-3 py-1.5 shadow-lift">
                  <span className="truncate text-xs font-black text-ink">{slide?.title}</span>
                </div>
              )
            }}
          />
        </div>
      )}

      <div className="space-y-1.5 border-t border-hairline pt-2.5">
        <button
          type="button"
          onClick={() => navigate('/bank')}
          className="flex w-full items-center gap-2 rounded-xl border border-hairline bg-surface px-2.5 py-2 text-xs font-bold text-ink-2 transition hover:bg-sunken"
        >
          <BookMarked className="size-4 text-brand" />
          بانک سؤال
          <Badge className="ms-auto">{toFaDigits(questions.length)}</Badge>
        </button>
        <button
          type="button"
          onClick={() => setHelp(true)}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-bold text-ink-3 transition hover:bg-sunken hover:text-ink"
        >
          <Keyboard className="size-4" />
          کلیدهای میان‌بر
          <kbd className="kbd ms-auto">?</kbd>
        </button>
      </div>
    </div>
  )

  const activeSlide = pres?.slides.find((s) => s.id === preview) ?? null

  return (
    <div className="min-h-screen bg-canvas font-vazir text-ink">
      <Toasts />

      <a
        href="#deck"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[130] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-black focus:shadow-pop"
      >
        پرش به محتوای ارائه
      </a>

      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-e border-hairline bg-surface lg:block">
          <div className="h-full p-3">{rail}</div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-hairline bg-surface/92 px-3 py-2 backdrop-blur">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="inline-flex size-9 items-center justify-center rounded-xl border border-hairline text-ink-2 lg:hidden"
              aria-label="نمایش کتابخانه"
            >
              <Library className="size-4" />
            </button>

            <Input
              value={pres?.title ?? ''}
              onChange={(e) => patch((p) => ({ ...p, title: e.target.value }))}
              placeholder="عنوان ارائه"
              aria-label="عنوان ارائه"
              disabled={!pres}
              className="h-9 max-w-xs flex-1 border-transparent bg-transparent px-2 text-base font-black hover:bg-sunken focus:bg-surface"
            />

            <div className="ms-auto flex items-center gap-1.5">
              <IconButton icon={Undo2} label="واگرد (Ctrl+Z)" disabled={past.length === 0} onClick={undo} />
              <IconButton icon={Redo2} label="ازنو (Ctrl+Shift+Z)" disabled={future.length === 0} onClick={redo} />
              <IconButton icon={BookMarked} label="درج سؤال از بانک" disabled={!pres} onClick={openPicker} />
              <IconButton icon={Settings2} label="تنظیمات" disabled={!pres} onClick={() => setSettings(true)} />
              <IconButton
                icon={Trash2}
                label="حذف این ارائه"
                variant="danger"
                disabled={!pres}
                onClick={() => pres && requestDelete(pres)}
              />
              <IconButton icon={Keyboard} label="کلیدهای میان‌بر" onClick={() => setHelp(true)} />
              <Button
                size="sm"
                variant="primary"
                icon={MonitorPlay}
                disabled={!pres}
                onClick={() => pres && navigate(`/view/${pres.id}`)}
              >
                اجرا
              </Button>
            </div>
          </header>

          <div className="sticky top-[3.25rem] z-30 flex flex-wrap items-center gap-1.5 border-b border-hairline bg-canvas/92 px-3 py-2 backdrop-blur">
            <Button size="sm" variant="subtle" icon={Plus} onClick={addSlide}>
              بخش تازه
            </Button>
            <Button size="sm" variant="subtle" icon={Gauge} disabled={!findLastAnimation()} onClick={openStudio}>
              استودیوی انیمیشن
            </Button>
            <Button size="sm" variant="primary" icon={BookMarked} onClick={loadLesson}>
              درس حرکت‌شناسی
            </Button>
            <Button size="sm" variant="subtle" icon={Sparkles} onClick={loadSample}>
              نمونه
            </Button>
            <span className="ms-auto flex flex-wrap items-center gap-1.5">
              <Badge>{toFaDigits(stats.slides)} بخش</Badge>
              <Badge>{toFaDigits(stats.blocks)} کادر</Badge>
              {stats.quizzes > 0 && <Badge tone="accent">{toFaDigits(stats.quizzes)} پرسش</Badge>}
              {stats.anims > 0 && <Badge tone="brand">{toFaDigits(stats.anims)} انیمیشن</Badge>}
              <Badge>~{toFaDigits(stats.mins)} دقیقه</Badge>
            </span>
          </div>

          <main id="deck" className="px-3 py-4">
            {!pres ? (
              <Empty
                icon={Library}
                title="هنوز ارائه‌ای ندارید"
                body="یک ارائهٔ تازه بسازید یا نمونهٔ آماده را بارگذاری کنید. همه‌چیز خودکار در مرورگر ذخیره می‌شود."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="primary" icon={BookMarked} onClick={loadLesson}>
                      درس آمادهٔ حرکت‌شناسی
                    </Button>
                    <Button variant="outline" icon={Plus} onClick={newDeck}>
                      ارائهٔ تازه
                    </Button>
                    <Button variant="outline" icon={Sparkles} onClick={loadSample}>
                      بارگذاری نمونه
                    </Button>
                    <Button variant="subtle" icon={Wand2} onClick={seedBank}>
                      بانک سؤال نمونه
                    </Button>
                  </div>
                }
              />
            ) : (
              <div className="mx-auto max-w-6xl space-y-4">
                {pres.slides.map((slide, si) => (
                  <section key={slide.id} id={`slide-${slide.id}`} className="surface scroll-mt-28 rounded-3xl p-4">
                    <header className="flex flex-wrap items-center gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-ink text-xs font-black text-canvas">
                        {si + 1}
                      </span>
                      <Input
                        value={slide.title}
                        onChange={(e) => updateSlide(slide.id, (s) => ({ ...s, title: e.target.value }))}
                        placeholder="عنوان بخش"
                        aria-label={`عنوان بخش ${toFaDigits(si + 1)}`}
                        className="h-9 max-w-md flex-1 border-transparent bg-transparent px-2 text-lg font-black hover:bg-sunken focus:bg-surface"
                      />
                      <span className="ms-auto flex items-center gap-1">
                        <Button size="xs" variant="subtle" icon={Eye} onClick={() => setPreview(slide.id)}>
                          پیش‌نمایش
                        </Button>
                        <Menu
                          align="end"
                          label={`تنظیمات بخش ${toFaDigits(si + 1)}`}
                          icon={MoreHorizontal}
                          triggerSize="sm"
                          items={
                            [
                              { type: 'item', key: 'dup', label: 'تکثیر بخش', icon: <Copy className="size-4" />, onSelect: () => duplicateSlide(slide.id) },
                              { type: 'item', key: 'up', label: 'یک پله بالا', disabled: si === 0, onSelect: () => reorderSlides(si, si - 1) },
                              {
                                type: 'item',
                                key: 'down',
                                label: 'یک پله پایین',
                                disabled: si === pres.slides.length - 1,
                                onSelect: () => reorderSlides(si, si + 1),
                              },
                              { type: 'sep', key: 's' },
                              { type: 'item', key: 'del', label: 'حذف بخش', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => removeSlide(slide.id) },
                            ] satisfies MenuItem[]
                          }
                        />
                      </span>
                    </header>

                    {slide.steps.length === 0 ? (
                      <Empty
                        className="mt-3"
                        icon={Plus}
                        title="این بخش خالی است"
                        body="یک کادر اضافه کنید — متن، فرمول، تصویر، پرسش یا انیمیشن. عرض هر کادر بعداً قابل تغییر است."
                        action={
                          <Button size="sm" variant="primary" onClick={() => addStep(slide.id)}>
                            افزودن کادر
                          </Button>
                        }
                      />
                    ) : (
                      <div className="mt-3">
                      <SortableGrid
                        label={`کادرهای بخش ${toFaDigits(si + 1)}`}
                        ids={slide.steps.map((s) => s.id)}
                        spans={Object.fromEntries(
                          slide.steps.map((s) => [s.id, spanCols(s.span)]),
                        )}
                        onReorder={(from, to) => reorderSteps(slide.id, from, to)}
                        renderOverlay={(id) => {
                          const st = slide.steps.find((x) => x.id === id)
                          if (!st) return null
                          const meta = BLOCK_META[st.kind]
                          return (
                            <div className="flex items-center gap-2 rounded-2xl border border-brand bg-surface px-3 py-2 shadow-lift">
                              <span className="size-2.5 rounded-full" style={{ background: meta.accent }} />
                              <span className="text-xs font-black text-ink">{KIND_LABEL[st.kind]}</span>
                            </div>
                          )
                        }}
                      >
                        {(drag) => {
                          const step = slide.steps.find((s) => s.id === drag.id)
                          if (!step) return null
                          const index = slide.steps.indexOf(step)
                          const linked =
                            step.kind === 'quiz' && step.bankId ? questions.find((q) => q.id === step.bankId) : undefined
                          return (
                            <BlockCard
                              step={step}
                              index={index}
                              total={slide.steps.length}
                              drag={drag}
                              quizMeta={linked ? { source: linked.source, tags: linked.tags } : undefined}
                              onChange={(next) => setStep(slide.id, index, next)}
                              onDuplicate={() => duplicateStep(slide.id, index)}
                              onRemove={() => removeStep(slide.id, index)}
                              onMove={(d) => moveStep(slide.id, index, d)}
                              onSpan={(span) => setStep(slide.id, index, { ...step, span })}
                              onKind={(kind) => changeKind(slide.id, index, kind)}
                              onInsertQuestion={() => setPicker({ slideId: slide.id, index })}
                              onReviewQuestion={() =>
                                linked && navigate(`/bank?q=${encodeURIComponent(linked.tags.join(':'))}`)
                              }
                              onOpenStudio={
                                step.kind === 'animation'
                                  ? () => navigate(`/studio/${pres.id}/${slide.id}/${step.id}`)
                                  : undefined
                              }
                            />
                          )
                        }}
                      </SortableGrid>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-2xl border border-dashed border-hairline p-2">
                      <span className="px-1 text-2xs font-black text-ink-3">افزودن کادر:</span>
                      {BLOCK_KINDS.map((k) => {
                        const meta = BLOCK_META[k]
                        const I = meta.icon
                        return (
                          <button
                            key={k}
                            type="button"
                            title={meta.label}
                            onClick={() => addStep(slide.id, k)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-hairline bg-surface px-2 text-2xs font-bold text-ink-2 transition hover:border-brand/60 hover:bg-soft"
                          >
                            <I className="size-3.5" style={{ color: meta.accent }} />
                            {meta.label}
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => setPicker({ slideId: slide.id, index: slide.steps.length - 1 })}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-brand/40 bg-brand-soft px-2 text-2xs font-black text-brand transition hover:bg-brand-soft/70"
                      >
                        <BookMarked className="size-3.5" />
                        از بانک سؤال
                      </button>
                    </div>

                    <Input
                      value={slide.notes ?? ''}
                      onChange={(e) => updateSlide(slide.id, (s) => ({ ...s, notes: e.target.value }))}
                      placeholder="یادداشت معلم — در حالت نمایش با کلید N دیده می‌شود"
                      aria-label={`یادداشت معلم بخش ${toFaDigits(si + 1)}`}
                      className="mt-3 h-9 border-warn/40 bg-warn/[0.06] text-xs"
                    />
                  </section>
                ))}

                <Button variant="subtle" icon={Plus} block onClick={addSlide}>
                  افزودن بخش
                </Button>

                <div className="flex flex-wrap items-center gap-1.5 pt-2">
                  <Button size="xs" variant="subtle" icon={Download} onClick={() => pres && downloadJSON(pres, safeFilename(pres.title))}>
                    خروجی این ارائه
                  </Button>
                  <Button size="xs" variant="subtle" icon={Download} onClick={() => downloadJSON(library, 'presentations')}>
                    خروجی همه
                  </Button>
                  <Button size="xs" variant="subtle" icon={Upload} onClick={openImportDialog}>
                    ورود JSON
                  </Button>
                  <Button size="xs" variant="subtle" icon={Copy} onClick={duplicateDeck} disabled={!pres}>
                    تکثیر ارائه
                  </Button>
                  <input
                    id="deck-import"
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleImport(f)
                      e.target.value = ''
                    }}
                  />
                </div>

                <div className="h-8" />
              </div>
            )}
          </main>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-[70] lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-slate-950/50" />
          <div
            className="absolute inset-y-0 end-0 w-80 max-w-[88vw] border-s border-hairline bg-canvas p-3 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink">کتابخانه</h2>
              <IconButton icon={X} label="بستن" size="sm" onClick={() => setDrawer(false)} />
            </div>
            <div className="h-[calc(100%-2.5rem)]">{rail}</div>
          </div>
        </div>
      )}

      <Modal open={settings} onClose={() => setSettings(false)} title="تنظیمات ارائه" size="md">
        {pres && (
          <div className="space-y-4">
            <Field label="توضیح کوتاه">
              <textarea
                value={pres.description ?? ''}
                onChange={(e) => patch((p) => ({ ...p, description: e.target.value }))}
                placeholder="این ارائه دربارهٔ چیست؟"
                rows={2}
                className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand/70 focus:ring-2 focus:ring-brand/20"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="تم">
                <Select
                  value={pres.theme ?? 'light'}
                  onChange={(e) => patch((p) => ({ ...p, theme: e.target.value as PresentationTheme }))}
                >
                  {Object.entries(THEME_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="چیدمان کادرها" hint="«جریان» عرض انتخابی هر کادر را رعایت می‌کند.">
                <Segmented
                  value={pres.layout ?? 'flow'}
                  onChange={(v) => patch((p) => ({ ...p, layout: v }))}
                  options={[
                    { value: 'flow', label: 'جریان' },
                    { value: 'stack', label: 'ستونی' },
                  ]}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
              <Button variant="outline" icon={Pencil} onClick={() => requestRename(pres)}>
                تغییر نام
              </Button>
              <Button variant="danger" icon={Trash2} onClick={() => requestDelete(pres)}>
                حذف این ارائه
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={preview !== null} onClose={() => setPreview(null)} size="xl" title={activeSlide?.title} subtitle="پیش‌نمایش زنده — همهٔ کادرها باز">
        {activeSlide && (
          <>
            {activeSlide.steps.length === 0 && <p className="text-sm text-ink-3">این بخش کادری ندارد.</p>}
            {/* Same 6-column grid as the presenter, so the preview shows the
                real widths instead of a stack of full-bleed blocks. */}
            <div className="block-grid">
              {activeSlide.steps.map((st) => (
                <div key={st.id} className={cn('min-w-0', spanClass(st.span))}>
                  <StepView step={st} interactive />
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      <QuestionPicker
        open={picker !== null}
        questions={questions}
        onClose={() => setPicker(null)}
        onInsert={(q) => picker && insertQuestion(picker.slideId, picker.index, q)}
        onCreate={(seed) => {
          if (!picker) return
          setCreating({ seed, slideId: picker.slideId, index: picker.index })
          setPicker(null)
        }}
      />

      <Modal
        open={creating !== null}
        onClose={() => setCreating(null)}
        title="سؤال تازه"
        subtitle="با همین برچسب‌ها ساخته و بلافاصله در یادداشت درج می‌شود"
        size="lg"
      >
        {creating && (
          <QuestionEditor
            allQuestions={questions}
            initial={
              creating.seed.includes(':')
                ? { ...emptyQuestion(), tags: creating.seed.split(':').map((x) => x.trim()).filter(Boolean) }
                : undefined
            }
            onSave={(q) => {
              putQuestion(q)
              setStep(creating.slideId, creating.index, toQuizStep(q))
              setCreating(null)
              toast('سؤال ساخته و درج شد ✓')
            }}
            onCancel={() => setCreating(null)}
          />
        )}
      </Modal>

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="تغییر نام ارائه"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              انصراف
            </Button>
            <Button variant="primary" onClick={commitRename}>
              ذخیره
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            commitRename()
          }}
        >
          <Field label="عنوان ارائه">
            <Input
              data-autofocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="عنوان ارائه"
            />
          </Field>
        </form>
      </Modal>

      <Confirm
        open={confirmDelete !== null}
        title={`«${confirmDelete?.title ?? ''}» حذف شود؟`}
        body="این کار برگشت‌پذیر نیست. پیش از حذف، خروجی JSON بگیرید."
        onConfirm={() => {
          if (confirmDelete) {
            const id = confirmDelete.id
            removePresentation(id)
            const rest = library.filter((p) => p.id !== id)
            if (activeId === id) setActiveId(rest[0]?.id ?? '')
            toast('حذف شد')
          }
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ShortcutsSheet open={help} onClose={() => setHelp(false)} />
      <CommandPalette open={palette} commands={commands} onClose={() => setPalette(false)} />
    </div>
  )
}
