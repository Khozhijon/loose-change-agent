// The window another site's assistant opens when its visitor asks for a private statement review.
// The visitor drops the statement HERE, on this site, so it never passes through the other site's
// page or its assistant. Only a summary leaves, after the visitor reads it and presses Send.
import {Ledger} from '../page/ledger.ts'

const STYLE = `
body.review-window { margin: 0 }
.review-window main { max-width: 640px; margin: 0 auto; padding: 20px 16px 40px }
.review-window h1 { font: 700 1.5rem var(--serif); margin: 4px 0 8px }
.review-window .note { color: var(--soft); font-size: .92rem }
.review-window .box { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 14px 0; box-shadow: var(--shadow) }
.review-window .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px }
.review-window pre { white-space: pre-wrap; overflow-wrap: anywhere; font: .8rem var(--mono); max-height: 240px; overflow: auto; margin: 8px 0 0 }
.review-window .err { color: var(--red) }
`

export function summaryToShare(ledger: Ledger) {
  const s = ledger.snapshot()
  if (!s.loaded) return null
  const snap = s as Exclude<typeof s, {note: string}>
  return {
    period: snap.period,
    lines: snap.lines,
    totalsUsd: snap.totalsUsd,
    topCategories: snap.categories.slice(0, 6),
    regularCharges: snap.regularCharges.map(r => ({merchant: r.merchant, cadence: r.cadence, perYearUsd: r.perYearUsd, stillActive: r.stillActive, ...(r.priceRise ? {priceRise: r.priceRise} : {})})),
    alerts: snap.alerts.map(a => ({kind: a.kind, title: a.title, perYearUsd: a.perYearUsd ?? a.amountUsd})),
    looseChangePerYearUsd: snap.looseChangePerYearUsd,
    note: 'Summary only. The statement itself, its lines and the bank wording never left the visitor\'s browser.',
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text) e.textContent = text
  if (cls) e.className = cls
  return e
}

/** Runs in the bridge window. Resolves with what the visitor chose to send, or a refusal. */
export function openReview(callerOrigin: string | undefined, resolve: (value: unknown) => void): void {
  const caller = (callerOrigin ?? 'another site').replace(/^https?:\/\//, '')
  document.title = 'Private statement review - Loose Change'
  for (const href of [new URL('../style.css', document.baseURI).href]) {
    const link = el('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.append(link)
  }
  document.head.append(el('style', STYLE))
  document.body.classList.add('review-window')

  const ledger = new Ledger()
  const main = el('main')
  main.append(
    el('p', 'Private statement review', 'eyebrow'),
    el('h1', 'Check a statement for loose change'),
    el('p', `The assistant on ${caller} asked us to review your bank statement. Choose the file here, not in its chat. It is read inside this window and goes nowhere. You decide below whether ${caller} gets a short summary.`, 'note'),
  )
  const pick = el('div', '', 'box')
  const file = el('input')
  file.type = 'file'
  file.accept = '.csv,.tsv,.txt,text/csv,text/plain'
  file.setAttribute('aria-label', 'Choose a statement file')
  const sample = el('button', 'Use the sample statement instead', 'btn')
  sample.type = 'button'
  const error = el('p', '', 'err')
  error.setAttribute('role', 'alert')
  pick.append(el('strong', 'Your statement (CSV from your bank)'), el('p', '', 'row'), error)
  pick.querySelector('.row')!.append(file, sample)
  const result = el('div')
  const decline = el('button', 'Keep it private', 'btn')
  decline.type = 'button'
  const send = el('button', `Send the summary to ${caller}`, 'btn primary')
  send.type = 'button'
  main.append(pick, result)
  document.body.append(main)

  let finished = false
  const finish = (value: unknown) => {
    if (finished) return
    finished = true
    resolve(value)
    main.replaceChildren(el('h1', 'Done'), el('p', 'You can close this window.', 'note'))
    try {
      window.close()
    } catch {
      // The opener may not allow it; the message above stays.
    }
  }

  const show = () => {
    const summary = summaryToShare(ledger)
    result.replaceChildren()
    if (!summary) return
    const box = el('div', '', 'box')
    box.append(
      el('strong', `Found about $${Math.round(summary.looseChangePerYearUsd)} a year of loose change in ${summary.alerts.length} alerts.`),
      el('p', `${summary.regularCharges.length} regular charges, ${summary.lines} lines, ${summary.period.from} to ${summary.period.to}.`, 'note'),
      el('p', `This is exactly what ${caller} would get (no lines, no bank wording):`, 'note'),
    )
    const pre = el('pre', JSON.stringify(summary, null, 2))
    const row = el('div', '', 'row')
    row.append(send, decline)
    box.append(pre, row)
    result.append(box)
    send.focus()
  }
  const load = (text: string, name: string) => {
    const r = ledger.loadCsv(text, name)
    error.textContent = r.ok ? '' : r.reason
    show()
  }
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    if (f) load(await f.text(), f.name)
  })
  sample.addEventListener('click', () => {
    const r = ledger.loadSample()
    error.textContent = r.ok ? '' : r.reason
    show()
  })
  send.addEventListener('click', () => finish({ok: true, summary: summaryToShare(ledger)}))
  decline.addEventListener('click', () => finish({ok: false, reason: 'The visitor kept the statement private. Nothing was shared.'}))
  window.addEventListener('pagehide', () => finish({ok: false, reason: 'The visitor closed the window. Nothing was shared.'}))
  file.focus()
}
