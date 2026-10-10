'use client'

import { Keyboard } from 'lucide-react'
import { useHotkeyIndex } from '../../lib/hotkeys'
import { prettyCombo } from '../../lib/utils'
import { Modal } from './overlay'

/**
 * Live shortcut reference. It reads the hotkey registry, so anything the app
 * registers at runtime shows up here automatically — nothing goes stale.
 */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const entries = useHotkeyIndex().filter((h) => !h.hidden)

  // Several bindings can share a label (`?` arrives as three different combos
  // depending on layout). Collapse them into one row listing every combo.
  const merged = new Map<string, { label: string; group: string; combos: string[] }>()
  for (const h of entries) {
    const key = `${h.group}::${h.label}`
    const prev = merged.get(key)
    if (prev) {
      if (!prev.combos.includes(h.combo)) prev.combos.push(h.combo)
    } else {
      merged.set(key, { label: h.label, group: h.group, combos: [h.combo] })
    }
  }

  const groups = new Map<string, { label: string; group: string; combos: string[] }[]>()
  for (const row of merged.values()) {
    groups.set(row.group, [...(groups.get(row.group) ?? []), row])
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Keyboard className="size-4 text-brand" />
          کلیدهای میان‌بر
        </span>
      }
      subtitle="همه‌چیز بدون ماوس هم کار می‌کند"
      bodyClassName="p-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {[...groups.entries()].map(([group, items]) => (
          <section key={group}>
            <h3 className="mb-2 text-2xs font-black uppercase tracking-wide text-ink-3">{group}</h3>
            <ul className="space-y-1">
              {items.map((h) => (
                <li key={h.label} className="flex items-center gap-3 rounded-xl bg-sunken/60 px-3 py-1.5">
                  <span className="flex shrink-0 items-center gap-1">
                    {h.combos.map((c) => (
                      <kbd key={c} className="kbd">
                        {prettyCombo(c)}
                      </kbd>
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-bold text-ink-2">{h.label}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {entries.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-3">هنوز میان‌بری ثبت نشده — این صفحه زنده به‌روز می‌شود.</p>
      )}
    </Modal>
  )
}
