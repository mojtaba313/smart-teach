/**
 * Does a deck actually survive a round trip?
 *
 * This exists because the app looked fine locally and was broken in
 * production, and the difference was invisible until you tried to create
 * something. The failure was an ordering bug: the editor derived its working
 * document from a store that had not loaded yet, so writes composed against
 * the wrong deck and never reached the network.
 *
 * So the check drives the real UI against the real API and asserts on the
 * database, not on what the screen shows. A screen that renders correctly while
 * the write silently fails is exactly the case that got through.
 *
 *   node .smoketest/deck-roundtrip.mjs
 */

import { chromium } from '/home/mojtaba/Desktop/projects/.smoketest/node_modules/playwright/index.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5188'
const failures = []
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures.push(name)
}

const getJson = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, init)
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

const run = async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  const writes = []
  page.on('request', (r) => {
    const m = r.method()
    if (r.url().includes('/api/') && m !== 'GET') writes.push(`${m} ${r.url().split('/api/')[1]}`)
  })

  await page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // --- the library must load at all, or nothing downstream can work -------
  const initial = await getJson('/api/presentations')
  ok('library loads from the API', Array.isArray(initial.body) && initial.body.length > 0,
     `${Array.isArray(initial.body) ? initial.body.length : 0} deck(s)`)

  // --- create ------------------------------------------------------------
  const before = (await getJson('/api/presentations')).body.length
  // The sidebar's new-deck control is an icon button with an aria-label; a
  // text selector matched a deck title instead and edited the wrong document.
  await page.getByRole('button', { name: 'ارائهٔ تازه' }).first().click()
  await page.waitForTimeout(2500)

  const after = await getJson('/api/presentations')
  ok('creating a deck writes to the database', after.body.length === before + 1,
     `${before} -> ${after.body.length}`)

  // The list is ordered by updatedAt, so the deck just created is the newest
  // — not necessarily the last element, which is what the first version
  // assumed and which silently picked a seeded deck instead.
  const created = [...after.body].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  ok('the new deck has an id', typeof created?.id === 'string' && created.id.length > 0, created?.id)
  ok('the new deck is empty', (created?.slides?.length ?? 0) === 1 && created?.title?.includes('تازه'),
     `"${created?.title}"`)

  /**
   * The deck title box, by its own placeholder.
   *
   * "عنوان ارائه" is the deck and "عنوان بخش" is a slide — both of which hold
   * the same text on a fresh deck, so a value-based selector picks the slide
   * and writes the deck's name into it.
   */
  const titleBox = page.getByPlaceholder('عنوان ارائه')

  // --- the editor must have a document open, not `undefined` --------------
  const openTitle = await titleBox.inputValue().catch(() => '')
  ok('an editor is open on the new deck', openTitle.length > 0, `title="${openTitle}"`)

  // --- typing must reach the server ---------------------------------------
  const writesBefore = writes.length
  // `fill` sets the value and fires one input event, which is what a
  // controlled React input wants. Typing character by character fights the
  // re-render, and Ctrl+A did not select in this browser.
  await titleBox.fill('RoundTripProbe')
  await page.waitForTimeout(2000)

  const reread = await getJson(`/api/presentations/${created.id}`)
  ok('editing the title persists',
     JSON.stringify(reread.body ?? {}).includes('RoundTripProbe'),
     reread.body?.title ?? '(not found)')

  // --- adding a slide must persist too ------------------------------------
  const slidesBefore = reread.body?.slides?.length ?? 0
  await page.getByRole('button', { name: /بخش تازه|افزودن بخش/ }).first().click().catch(() => {
    throw new Error('could not find the add-slide control')
  })
  await page.waitForTimeout(2000)
  const withSlide = await getJson(`/api/presentations/${created.id}`)
  ok('adding a slide persists', (withSlide.body?.slides?.length ?? 0) > slidesBefore,
     `${slidesBefore} -> ${withSlide.body?.slides?.length}`)

  ok('no page errors', errors.length === 0, errors[0] ?? '')
  ok('the editor issued write requests', writes.length > writesBefore, `${writes.length} total`)

  // --- clean up so a repeat run is meaningful ------------------------------
  await getJson(`/api/presentations/${created.id}`, { method: 'DELETE' })

  await browser.close()

  console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILED: ${failures.join(', ')}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error('harness error:', e.message)
  process.exit(2)
})