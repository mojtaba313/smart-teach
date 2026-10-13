import { describe, expect, it } from 'vitest'
import { compileAnimation, evaluate, valueOf } from './engine'
import type { Animation2, Param } from '../../types/anim2'
import { ANIM2_SCHEMA } from '../../types/anim2'
import { controlKind } from '../../components/anim2/Controls'

const base: Animation2 = {
  schema: ANIM2_SCHEMA,
  title: 'c',
  duration: 10,
  params: {},
  cues: [],
  nodes: [],
}

describe('control kinds', () => {
  it('defaults to a slider', () => {
    expect(controlKind({ value: 1 })).toBe('slider')
  })

  it('honours the v1 slider flag either way', () => {
    expect(controlKind({ value: 1, slider: true })).toBe('slider')
    expect(controlKind({ value: 1, slider: false })).toBe('slider')
  })

  it('prefers an explicit control over the legacy flag', () => {
    expect(controlKind({ value: 1, slider: true, control: 'toggle' })).toBe('toggle')
    expect(controlKind({ value: 0, control: 'button' })).toBe('button')
  })
})

describe('control values reach expressions', () => {
  const withParam = (param: Param, expr: string): Animation2 => ({
    ...base,
    params: { q: param },
    nodes: [
      {
        id: 'd',
        type: 'text',
        text: { expr },
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        opacity: 1,
        visible: true,
        locked: false,
      } as never,
    ],
  })

  it('a toggle reads as 0 or 1, not as a boolean type', () => {
    const anim = withParam({ value: 0, control: 'toggle' }, 'q * 10')
    expect(evaluate(compileAnimation(anim), 0).nodes[0].text).toBe('0')
    expect(evaluate(compileAnimation(anim), 0, { q: 1 }).nodes[0].text).toBe('10')
  })

  it('a select indexes into its options', () => {
    const anim = withParam({ value: 0, control: 'select', options: ['آ', 'ب', 'پ'] }, 'q')
    expect(valueOf(compileAnimation(anim), 0)['q']).toBe(0)
    expect(valueOf(compileAnimation(anim), 0, { q: 2 })['q']).toBe(2)
  })

  it('a button writes a number like any other knob', () => {
    const anim = withParam({ value: 0, control: 'button' }, 'q')
    expect(valueOf(compileAnimation(anim), 0, { q: 1 })['q']).toBe(1)
  })

  it('overrides do not leak between evaluations', () => {
    const compiled = compileAnimation(withParam({ value: 2 }, 'q'))
    evaluate(compiled, 0, { q: 99 })
    // A later frame with no overrides must read the declared default again.
    expect(valueOf(compiled, 0)['q']).toBe(2)
  })
})

describe('control actions', () => {
  it('a button can carry the same actions an event does', () => {
    const anim: Animation2 = {
      ...base,
      params: { go: { value: 0, control: 'button', actions: [{ type: 'log', message: 'زد' }] } },
    }
    const compiled = compileAnimation(anim)
    const actions = compiled.params.go.actions ?? []
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('log')
  })

  it('keeps the actions through compilation untouched', () => {
    const anim: Animation2 = {
      ...base,
      params: {
        go: {
          value: 0,
          control: 'button',
          pulseFor: 0.4,
          resetTo: 0,
          actions: [{ type: 'spawnParticles', at: ['0', '0'], count: 5, color: '#fff', speed: 1, lifetime: 1 }],
        },
      },
    }
    const p = compileAnimation(anim).params.go
    expect(p.pulseFor).toBe(0.4)
    expect(p.resetTo).toBe(0)
    expect(p.actions?.[0].type).toBe('spawnParticles')
  })
})