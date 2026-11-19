// The page's state and rules. The page's buttons and the agent's tools both call these methods,
// so the assistant can never do anything the page cannot. The classifier here is the rules-only
// path of Loose Change: bank wording rules plus about 480 known merchants. Anything it cannot
// place is marked "needs a look", and the visitor's assistant can place it (set_categories).
import {findAlerts, looseChange} from '../core/alerts.ts'
import {CATEGORIES, category, CATEGORY_IDS} from '../core/categories.ts'
import {Classifier, REVIEW_BELOW} from '../core/classify.ts'
import {importStatement} from '../core/csv.ts'
import {formatDay, isoDay, toDay} from '../core/dates.ts'
import {money} from '../core/money.ts'
import {findRecurring, perYear, upcoming} from '../core/recurring.ts'
import {sampleStatement} from '../core/sample.ts'
import {summarise, type Summary} from '../core/summary.ts'
import type {Alert, CategoryId, Cents, Day, ImportResult, Recurring, Txn, Verdict} from '../core/types.ts'

export type Refusal = {ok: false; reason: string}
const TAUGHT_KEY = 'loose-change-agent:taught'
const MAX_LINES_PER_ITEM = 6

function dollars(cents: Cents): number {
  return Math.round(cents) / 100
}

export function parseIso(text: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!m) return null
  const day = toDay(Number(m[1]), Number(m[2]), Number(m[3]))
  return isoDay(day) === text.trim() ? day : null
}

export class Ledger {
  /** The one page object. The page, the site actions and the tests all use it. */
  static page = new Ledger()

  fileName = ''
  imported: ImportResult | null = null
  verdicts: Verdict[] = []
  summary: Summary = summarise([], [])
  recurring: Recurring[] = []
  alerts: Alert[] = []
  /** Bumped by every change, so an irreversible action can refuse a stale view. */
  version = 0
  private classifier = new Classifier(null)
  private listeners: (() => void)[] = []

  constructor() {
    for (const t of Ledger.loadTaught()) this.classifier.teach(t.text, t.category, null)
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener)
  }

  private changed(): void {
    this.version++
    for (const l of this.listeners) l()
  }

  get loaded(): boolean {
    return !!this.imported && this.imported.txns.length > 0
  }

  get txns(): Txn[] {
    return this.imported?.txns ?? []
  }

  // ------------------------------------------------------------------ operations

  /** Read a statement the visitor chose. Nothing changes when it cannot be read. */
  loadCsv(text: string, fileName: string): {ok: true; lines: number; skipped: number} | Refusal {
    const imported = importStatement(text)
    if (!imported.txns.length) {
      const why = imported.skipped[0]?.why ?? 'No lines found.'
      return {ok: false, reason: `That file could not be read as a bank statement. ${why} Export your transactions as CSV from your bank and try again.`}
    }
    this.imported = imported
    this.fileName = fileName
    this.recompute()
    this.changed()
    return {ok: true, lines: imported.txns.length, skipped: imported.skipped.length}
  }

  loadSample(): {ok: true; lines: number; skipped: number} | Refusal {
    return this.loadCsv(sampleStatement(), 'sample-statement.csv (invented data)')
  }

  reset(): void {
    this.imported = null
    this.fileName = ''
    this.verdicts = []
    this.summary = summarise([], [])
    this.recurring = []
    this.alerts = []
    this.changed()
  }

  /** Put a merchant in a category. The visitor can undo it with forgetCategory. */
  setCategory(merchant: string, id: string): {ok: true; merchant: string; label: string; category: CategoryId; lines: number} | Refusal {
    if (!this.loaded) return {ok: false, reason: 'No statement is loaded yet.'}
    if (!CATEGORY_IDS.includes(id as CategoryId)) return {ok: false, reason: `Unknown category "${id}". Use one of: ${CATEGORY_IDS.join(', ')}.`}
    const key = this.findMerchant(merchant)
    if (!key) return {ok: false, reason: `No merchant in this statement matches "${merchant}". Use a name from the needs-a-look list.`}
    this.classifier.teach(key, id as CategoryId, null)
    Ledger.saveTaught(this.classifier.taught)
    this.recompute()
    this.changed()
    const lines = this.txns.filter(t => t.merchant === key).length
    return {ok: true, merchant: key, label: this.txns.find(t => t.merchant === key)!.label, category: id as CategoryId, lines}
  }

  forgetCategory(merchant: string): void {
    this.classifier.forget(merchant)
    Ledger.saveTaught(this.classifier.taught)
    this.recompute()
    this.changed()
  }

  /** Corrections the visitor or the assistant made, newest last. */
  taught(): {merchant: string; label: string; category: CategoryId}[] {
    return this.classifier.taught
      .map(t => ({merchant: t.text, label: this.txns.find(x => x.merchant === t.text)?.label ?? t.text, category: t.category}))
      .filter(t => this.txns.some(x => x.merchant === t.merchant))
  }

  private recompute(): void {
    const txns = this.txns
    this.verdicts = txns.map(t => this.classifier.classify(t.merchant, t.raw, t.amount, null))
    this.summary = summarise(txns, this.verdicts)
    this.recurring = findRecurring(txns, this.verdicts, this.summary.endDay)
    this.alerts = findAlerts(txns, this.verdicts, this.recurring, this.summary.startDay, this.summary.endDay)
  }

  private findMerchant(text: string): string | null {
    const q = text.toLowerCase().trim()
    const merchants = new Map<string, string>()
    for (const t of this.txns) merchants.set(t.merchant, t.label)
    if (merchants.has(q)) return q
    for (const [m, label] of merchants) if (label.toLowerCase() === q) return m
    const hits = [...merchants].filter(([m, label]) => m.includes(q) || label.toLowerCase().includes(q))
    return hits.length === 1 ? hits[0]![0] : null
  }

  // ------------------------------------------------------------------ what the assistant may read

  /** Merchants the rules could not place. These are the ones worth a look. */
  needsReview(): {merchant: string; label: string; lines: number; total: number}[] {
    const groups = new Map<string, {label: string; lines: number; cents: number}>()
    this.txns.forEach((t, i) => {
      const v = this.verdicts[i]!
      if (t.amount >= 0 || v.confidence >= REVIEW_BELOW) return
      const g = groups.get(t.merchant) ?? {label: t.label, lines: 0, cents: 0}
      g.lines++
      g.cents -= t.amount
      groups.set(t.merchant, g)
    })
    return [...groups]
      .map(([merchant, g]) => ({merchant, label: g.label, lines: g.lines, total: dollars(g.cents)}))
      .sort((a, b) => b.total - a.total)
  }

  /** A line as the assistant sees it: cleaned merchant name, date and amount. Never the bank's raw text. */
  line(t: Txn): {date: string; merchant: string; usd: number} {
    return {date: isoDay(t.day), merchant: t.label, usd: dollars(t.amount)}
  }

  /**
   * What the assistant may read. It holds cleaned merchant names, dates and amounts, and never
   * the bank's own wording, which can carry card or account numbers.
   */
  snapshot() {
    if (!this.loaded) {
      return {loaded: false, version: this.version, note: 'No statement is loaded. The visitor can drop in a CSV from their bank or try the sample statement.'}
    }
    const s = this.summary
    const byId = new Map(this.txns.map(t => [t.id, t]))
    return {
      loaded: true,
      version: this.version,
      file: this.fileName,
      lines: this.txns.length,
      unreadableLines: this.imported!.skipped.length,
      period: {from: isoDay(s.startDay), to: isoDay(s.endDay)},
      totalsUsd: {spent: dollars(s.spent), moneyIn: dollars(s.cameIn), movedBetweenAccounts: dollars(s.moved), perDay: dollars(s.perDay)},
      categories: s.byCategory.map(c => ({id: c.id, label: category(c.id).label, totalUsd: dollars(c.total), lines: c.count})),
      regularCharges: this.recurring.map(r => ({
        merchant: r.label,
        category: r.category,
        cadence: r.cadence,
        typicalUsd: dollars(r.typical),
        perYearUsd: dollars(r.yearly),
        charges: r.count,
        stillActive: r.active,
        nextExpected: isoDay(r.nextDay),
        ...(r.rise ? {priceRise: {fromUsd: dollars(r.rise.from), toUsd: dollars(r.rise.to), on: isoDay(r.rise.day)}} : {}),
      })),
      alerts: this.alerts.map(a => ({
        kind: a.kind,
        title: a.title,
        detail: a.detail,
        amountUsd: dollars(a.amount),
        ...(a.yearly ? {perYearUsd: dollars(a.yearly)} : {}),
        lines: a.txnIds.slice(0, MAX_LINES_PER_ITEM).map(id => this.line(byId.get(id)!)),
      })),
      looseChangePerYearUsd: dollars(looseChange(this.alerts)),
      needsALook: this.needsReview().slice(0, 30),
      categoriesYouCanUse: CATEGORIES.map(c => c.id),
    }
  }

  /**
   * Add up spending the way the visitor asked, from the statement and nothing else. Every filter
   * is optional; with none, it adds up everything spent.
   */
  query(args: {metric?: string; category?: string; merchant?: string; from?: string; to?: string}) {
    if (!this.loaded) return {ok: false as const, reason: 'No statement is loaded yet.'}
    const metric = args.metric ?? 'sum'
    const from = args.from ? parseIso(args.from) : null
    const to = args.to ? parseIso(args.to) : null
    if (args.from && from === null) return {ok: false as const, reason: `"${args.from}" is not a date. Use YYYY-MM-DD.`}
    if (args.to && to === null) return {ok: false as const, reason: `"${args.to}" is not a date. Use YYYY-MM-DD.`}
    if (args.category && !CATEGORY_IDS.includes(args.category as CategoryId)) return {ok: false as const, reason: `Unknown category "${args.category}".`}
    const needle = args.merchant?.toLowerCase().trim()
    const rows = this.txns.filter((t, i) => {
      if (from !== null && t.day < from) return false
      if (to !== null && t.day > to) return false
      const c = this.verdicts[i]!.category
      if (args.category) return (args.category === 'income' ? t.amount > 0 : t.amount < 0 && c === args.category) && (!needle || t.merchant.includes(needle) || t.label.toLowerCase().includes(needle))
      if (needle) return t.amount < 0 && (t.merchant.includes(needle) || t.label.toLowerCase().includes(needle))
      return t.amount < 0 && category(c).spending
    })
    const cents = rows.reduce((sum, t) => sum + Math.abs(t.amount), 0)
    const biggest = rows.reduce<Txn | null>((a, t) => (!a || Math.abs(t.amount) > Math.abs(a.amount) ? t : a), null)
    const perMerchant = new Map<string, number>()
    for (const t of rows) perMerchant.set(t.label, (perMerchant.get(t.label) ?? 0) + Math.abs(t.amount))
    return {
      ok: true as const,
      metric,
      matchedLines: rows.length,
      totalUsd: dollars(cents),
      averageUsd: rows.length ? dollars(Math.round(cents / rows.length)) : 0,
      biggest: biggest ? this.line(biggest) : null,
      topMerchants: [...perMerchant].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([merchant, c]) => ({merchant, totalUsd: dollars(c)})),
      sample: rows.slice(0, 8).map(t => this.line(t)),
      statementPeriod: {from: isoDay(this.summary.startDay), to: isoDay(this.summary.endDay)},
    }
  }

  // ------------------------------------------------------------------ the report (a file the visitor saves)

  /** The read-only check for saving the report: refuse when there is nothing to save or the view changed. */
  checkReport(expectedVersion: number): {ok: true; details: Record<string, string>} | Refusal {
    if (!this.loaded) return {ok: false, reason: 'No statement is loaded, so there is nothing to put in a report.'}
    if (expectedVersion !== this.version) return {ok: false, reason: `The statement view changed (version ${this.version}, not ${expectedVersion}). Read it again first.`}
    return {
      ok: true,
      details: {
        Period: `${formatDay(this.summary.startDay)} to ${formatDay(this.summary.endDay)}`,
        'Loose change found': `${money(looseChange(this.alerts), true)} a year in ${this.alerts.length} alerts`,
        'Regular charges': String(this.recurring.length),
        Contains: 'Totals, categories, regular charges and alerts. No bank wording, no card or account numbers.',
        'Saved as': 'loose-change-report.md, to your Downloads folder',
      },
    }
  }

  /** The report text. It uses the same cleaned names the assistant sees. */
  reportMarkdown(): string {
    const s = this.summary
    const lines: string[] = []
    lines.push(`# Loose Change report`, '')
    lines.push(`Statement: ${this.fileName}, ${formatDay(s.startDay)} to ${formatDay(s.endDay)} (${this.txns.length} lines).`, '')
    lines.push(`Spent ${money(s.spent)}; money in ${money(s.cameIn)}. About ${money(looseChange(this.alerts), true)} a year is loose change (see the alerts).`, '')
    lines.push('## Alerts', '')
    if (!this.alerts.length) lines.push('None found.')
    for (const a of this.alerts) lines.push(`- **${a.title}.** ${a.detail}${a.yearly ? ` About ${money(a.yearly, true)} a year.` : ''}`)
    lines.push('', '## Regular charges', '')
    lines.push('| Merchant | How often | Typical | Per year | Next expected |', '| --- | --- | --- | --- | --- |')
    for (const r of this.recurring) lines.push(`| ${r.label} | ${r.cadence} | ${money(r.typical)} | ${money(r.yearly, true)} | ${r.active ? formatDay(r.nextDay) : 'seems to have stopped'} |`)
    lines.push('', '## Spending by category', '')
    for (const c of s.byCategory) lines.push(`- ${category(c.id).label}: ${money(c.total, true)} (${c.count} lines)`)
    lines.push('', '_Made by Loose Change agent. It adds up what the statement says and is not financial advice._', '')
    return lines.join('\n')
  }

  upcomingCharges(days = 30) {
    return upcoming(this.recurring, this.summary.endDay, days)
  }

  yearlyOf(r: Recurring): Cents {
    return Math.round(r.typical * perYear(r.cadence))
  }

  // ------------------------------------------------------------------ remembered corrections

  private static loadTaught(): {text: string; category: CategoryId}[] {
    try {
      const list = JSON.parse(globalThis.localStorage?.getItem(TAUGHT_KEY) ?? '[]')
      return Array.isArray(list) ? list.filter(x => typeof x?.text === 'string' && CATEGORY_IDS.includes(x.category)) : []
    } catch {
      return []
    }
  }

  private static saveTaught(taught: {text: string; category: CategoryId}[]): void {
    try {
      globalThis.localStorage?.setItem(TAUGHT_KEY, JSON.stringify(taught.map(({text, category}) => ({text, category}))))
    } catch {
      // Private windows may refuse storage; corrections then last until the tab closes.
    }
  }
}
