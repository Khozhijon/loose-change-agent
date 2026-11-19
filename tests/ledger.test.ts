import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Ledger} from '../src/page/ledger.ts'
import {categorise} from '../src/bridge/categorise.ts'
import {summaryToShare} from '../src/bridge/review-window.ts'

function sample(): Ledger {
  const l = new Ledger()
  const r = l.loadSample()
  assert.equal(r.ok, true)
  return l
}

test('the sample statement gives the same loose change as the original Loose Change page', () => {
  const l = sample()
  const snap = l.snapshot() as any
  assert.equal(snap.loaded, true)
  assert.equal(Math.round(snap.looseChangePerYearUsd), 791)
  assert.ok(snap.alerts.length >= 10)
  assert.ok(snap.regularCharges.length >= 15)
})

test('the assistant never sees the bank wording, only cleaned names', () => {
  const l = sample()
  const text = JSON.stringify(l.snapshot()) + JSON.stringify(l.query({}))
  for (const t of l.txns.slice(0, 400)) {
    if (t.raw.length > 14 && t.raw.toLowerCase() !== t.label.toLowerCase()) assert.ok(!text.includes(t.raw), `raw line leaked: ${t.raw}`)
  }
})

test('an unreadable file is refused and changes nothing', () => {
  const l = sample()
  const before = l.version
  const r = l.loadCsv('hello,world\n1,2', 'x.csv')
  assert.equal(r.ok, false)
  assert.equal(l.version, before)
  assert.equal(l.txns.length, 400)
})

test('unknown merchants can be placed, and the placement can be undone', () => {
  const l = sample()
  const unknown = l.needsReview()
  assert.ok(unknown.length > 0)
  const first = unknown[0]!
  const before = l.summary.byCategory.find(c => c.id === 'other')!.total
  const r = l.setCategory(first.merchant, 'housing')
  assert.equal(r.ok, true)
  assert.ok(l.summary.byCategory.find(c => c.id === 'other')!.total < before)
  assert.ok(!l.needsReview().some(m => m.merchant === first.merchant))
  l.forgetCategory(first.merchant)
  assert.ok(l.needsReview().some(m => m.merchant === first.merchant))
})

test('bad categories and unknown merchants are refused with a reason', () => {
  const l = sample()
  const a = l.setCategory('zzzz not here', 'housing')
  assert.equal(a.ok, false)
  const b = l.setCategory(l.needsReview()[0]!.merchant, 'cryptocurrency')
  assert.equal(b.ok, false)
})

test('query adds up with the same numbers as the page', () => {
  const l = sample()
  const all = l.query({}) as any
  assert.equal(all.ok, true)
  assert.equal(all.totalUsd, (l.snapshot() as any).totalsUsd.spent)
  const sept = l.query({category: 'eating_out', from: '2026-09-01', to: '2026-09-30'}) as any
  assert.ok(sept.totalUsd > 0 && sept.totalUsd < all.totalUsd)
  assert.equal(l.query({from: 'last week'}).ok, false)
})

test('saving a report refuses a stale version and an empty page', () => {
  const l = new Ledger()
  assert.equal(l.checkReport(0).ok, false)
  l.loadSample()
  assert.equal(l.checkReport(l.version - 1).ok, false)
  const ok = l.checkReport(l.version)
  assert.equal(ok.ok, true)
  assert.ok(l.reportMarkdown().includes('## Alerts'))
})

test('categorise places known merchants and flags the unknown ones for review', () => {
  const out = categorise([{description: 'POS DEBIT 0412 SQ *BLUE BOTTLE COF OAKLAND CA #2231'}, {description: 'NETFLIX.COM 866-579-7172 CA'}, {description: 'KXQZ HOLDINGS 4417'}, {description: 'MONTHLY MAINTENANCE FEE'}])
  assert.equal(out[0]!.category, 'coffee')
  assert.equal(out[1]!.category, 'subscriptions')
  assert.equal(out[2]!.needsReview, true)
  assert.equal(out[3]!.category, 'fees')
})

test('the summary a caller gets has no lines and no bank wording', () => {
  const l = sample()
  const s = summaryToShare(l)!
  const text = JSON.stringify(s)
  assert.ok(!('lines' in (s.alerts[0] ?? {})))
  assert.ok(!text.includes('SQ *'))
  assert.ok(s.regularCharges.length > 0)
})
