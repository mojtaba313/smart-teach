import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Code2,
  Film,
  FunctionSquare,
  Gauge,
  Image as ImageIcon,
  Lightbulb,
  List,
  MessageSquareQuote,
  Type,
} from 'lucide-react'
import type { SlideStep, StepKind } from '../../types'
import { KIND_ACCENT, KIND_LABEL, defaultSpanFor } from '../../types'
import { cn } from '../../lib/utils'
import {
  CalloutBlock,
  CodeBlock,
  FormulaBlock,
  ImageBlock,
  ListBlock,
  QuizBlock,
  TextBlock,
  TrapBlock,
  VideoBlock,
} from './blocks'
import { AnimationPlayer } from './AnimationBlock'

export type BlockRenderProps = {
  interactive?: boolean
  /** presenter only: grab keyboard focus when this block is revealed */
  autoFocus?: boolean
  onAnswer?: (correct: boolean, picked: number) => void
  onOpenStudio?: () => void
  onReviewQuestion?: () => void
  onUnlinkQuestion?: () => void
  quizMeta?: { source?: string; tags?: string[] }
}

export type BlockMeta = {
  kind: StepKind
  label: string
  icon: LucideIcon
  accent: string
  defaultSpan: ReturnType<typeof defaultSpanFor>
  render: (step: SlideStep, props: BlockRenderProps) => ReactNode
}

function renderStep(step: SlideStep, props: BlockRenderProps): ReactNode {
  switch (step.kind) {
    case 'text':
      return <TextBlock value={step.value} />
    case 'list':
      return <ListBlock items={step.items} ordered={step.ordered} />
    case 'formula':
      return <FormulaBlock value={step.value} />
    case 'callout':
      return <CalloutBlock value={step.value} tone={step.tone} />
    case 'trap':
      return <TrapBlock value={step.value} />
    case 'image':
      return <ImageBlock value={step.value} alt={step.alt} caption={step.caption} />
    case 'video':
      return <VideoBlock value={step.value} caption={step.caption} />
    case 'code':
      return <CodeBlock value={step.value} caption={step.caption} />
    case 'quiz':
      return (
        <QuizBlock
          question={step.question}
          options={step.options}
          answerIndex={step.answerIndex}
          explanation={step.explanation}
          source={props.quizMeta?.source}
          tags={props.quizMeta?.tags}
          interactive={props.interactive}
          autoFocus={props.autoFocus}
          onAnswer={props.onAnswer}
          onReview={props.onReviewQuestion}
          onUnlink={props.onUnlinkQuestion}
        />
      )
    case 'animation':
      return (
        <AnimationPlayer anim={step.anim} onOpenStudio={props.onOpenStudio} />
      )
  }
}

const META: Record<StepKind, { icon: LucideIcon }> = {
  text: { icon: Type },
  list: { icon: List },
  formula: { icon: FunctionSquare },
  callout: { icon: Lightbulb },
  trap: { icon: AlertTriangle },
  image: { icon: ImageIcon },
  video: { icon: Film },
  code: { icon: Code2 },
  quiz: { icon: MessageSquareQuote },
  animation: { icon: Gauge },
}

export const BLOCK_META: Record<StepKind, BlockMeta> = Object.fromEntries(
  (Object.keys(KIND_LABEL) as StepKind[]).map((kind) => [
    kind,
    {
      kind,
      label: KIND_LABEL[kind],
      icon: META[kind].icon,
      accent: KIND_ACCENT[kind],
      defaultSpan: defaultSpanFor(kind),
      render: renderStep,
    },
  ]),
) as Record<StepKind, BlockMeta>

export const BLOCK_KINDS = Object.keys(BLOCK_META) as StepKind[]

/**
 * Renders a single block. Every interactive child stops propagation so the
 * presenter's click-to-advance never fires when you touch a control.
 */
export function StepView({ step, className, ...props }: { step: SlideStep; className?: string } & BlockRenderProps) {
  return <div className={cn('min-w-0', className)}>{BLOCK_META[step.kind].render(step, props)}</div>
}

export { renderRich } from './RichText'
