import {fromDay, toDay} from './dates.ts'
import type {Cadence, CategoryId, Cents, Day, Recurring, Txn, Verdict} from './types.ts'

interface Rhythm {
  cadence: Cadence
  days: number
  slack: number
  perYear: number
  /** Fewest charges before the rhythm is believed. */
  need: number
}

const RHYTHMS: Rhythm[] = [
  {cadence: 'weekly', days: 7, slack: 1.5, perYear: 52, need: 4},
  {cadence: 'every 2 weeks', days: 14, slack: 2, perYear: 26, need: 4},
  {cadence: 'monthly', days: 30.4, slack: 3.5, perYear: 12, need: 3},
  {cadence: 'every 3 months', days: 91.3, slack: 7, perYear: 4, need: 3},
  {cadence: 'yearly', days: 365.25, slack: 12, perYear: 1, need: 2},
]

/** Categories where a regular charge may honestly vary from one bill to the next. */
const MAY_VARY: Partial<Record<CategoryId, number>> = {bills: 0.6, housing: 0.15, subscriptions: 0.6, health: 0.3, education: 0.3, transfers: 0.1}

export function perYear(cadence: Cadence): number {
  return RHYTHMS.find(r => r.cadence === cadence)!.perYear
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function addCadence(day: Day, r: Rhythm): Day {
  if (r.cadence === 'weekly' || r.cadence === 'every 2 weeks') return day + r.days
  const {y, m, d} = fromDay(day)
  const months = r.cadence === 'monthly' ? 1 : r.cadence === 'every 3 months' ? 3 : 12
  const target = y * 12 + (m - 1) + months
  const ty = Math.floor(target / 12)
  const tm = (target % 12) + 1
  const lastOfMonth = fromDay(toDay(ty, tm + 1, 1) - 1).d
  return toDay(ty, tm, Math.min(d, lastOfMonth))
}

/**
 * Finds charges that come round on a rhythm: subscriptions, rent, bills, passes.
 *
 * A merchant counts when the gaps between its charges sit close to one rhythm and the amounts
 * are steady enough for its category. Coffee three times a week is a habit, not a subscription,
 * so everyday categories only count when the amount is the same to the cent.
 */
export function findRecurring(txns: Txn[], verdicts: Verdict[], endDay: Day): Recurring[] {
  const groups = new Map<string, Txn[]>()
  for (const t of txns) {
    if (t.amount >= 0) continue
    const c = verdicts[t.id]!.category
    if (c === 'fees' || c === 'cash') continue
    const g = groups.get(t.merchant)
    if (g) g.push(t)
    else groups.set(t.merchant, [t])
  }

  const found: Recurring[] = []
  for (const [merchant, all] of groups) {
    if (all.length < 2) continue
    all.sort((a, b) => a.day - b.day)
    // Two charges within three days are one bill and a possible duplicate, not two cycles.
    const charges: Txn[] = []
    for (const t of all) {
      const prev = charges[charges.length - 1]
      if (prev && t.day - prev.day <= 3) continue
      charges.push(t)
    }
    if (charges.length < 2) continue
    const gaps = charges.slice(1).map((t, i) => t.day - charges[i]!.day)
    const typicalGap = median(gaps)
    const rhythm = RHYTHMS.find(r => Math.abs(typicalGap - r.days) <= r.slack)
    if (!rhythm) continue
    // Most gaps must fit; a skipped cycle (a gap of two periods) is forgiven.
    const fits = gaps.filter(g => Math.abs(g - rhythm.days) <= rhythm.slack || Math.abs(g - 2 * rhythm.days) <= rhythm.slack * 1.5).length
    if (fits / gaps.length < 0.75) continue

    const verdict = verdicts[charges[charges.length - 1]!.id]!
    const amounts = charges.map(t => -t.amount)
    // A trial charge of a dollar or less at the start is not part of the pattern.
    const body = amounts.length > 2 && amounts[0]! <= 150 && amounts[1]! > amounts[0]! * 3 ? amounts.slice(1) : amounts
    const mid = median(body)
    const spread = mid > 0 ? (Math.max(...body) - Math.min(...body)) / mid : 0
    const allowed = MAY_VARY[verdict.category]
    const steady = spread <= 0.02
    // A subscription whose price was put up once or twice is still one subscription:
    // the amounts sit on a few flat steps instead of wandering.
    const steps: number[] = []
    for (const amount of body) if (!steps.some(s => Math.abs(s - amount) <= s * 0.005)) steps.push(amount)
    const stepped = body.length >= 3 && steps.length <= 3 && steps.length < body.length
    if (allowed === undefined ? !steady : spread > allowed && !stepped) continue
    const need = steady && allowed !== undefined ? Math.min(rhythm.need, rhythm.cadence === 'monthly' ? 2 : rhythm.need) : rhythm.need
    if (charges.length < need) continue

    const last = charges[charges.length - 1]!
    // A bill that wanders (electricity) is best described by its middle value, a fixed price by its latest.
    const typical = steady || stepped ? -last.amount : Math.round(median(body.slice(-6)))
    // A price rise: the latest charge is higher than a price that had held for at least two bills.
    let rise: Recurring['rise']
    for (let i = amounts.length - 1; i >= 2; i--) {
      const now = amounts[i]!
      const before = amounts[i - 1]!
      if (Math.abs(now - before) <= before * 0.005) continue
      const held = Math.abs(before - amounts[i - 2]!) <= before * 0.005
      if (now > before * 1.02 && held && amounts.slice(i).every(a => Math.abs(a - now) <= now * 0.005)) {
        rise = {from: before, to: now, day: charges[i]!.day}
      }
      break
    }
    const nextDay = addCadence(last.day, rhythm)
    found.push({
      merchant,
      label: last.label,
      category: verdict.category,
      ...(verdict.kind ? {kind: verdict.kind} : {}),
      cadence: rhythm.cadence,
      typical,
      yearly: Math.round(typical * rhythm.perYear),
      count: all.length,
      firstDay: charges[0]!.day,
      lastDay: last.day,
      nextDay,
      active: endDay - last.day <= rhythm.days * 1.5 + 5,
      ...(rise ? {rise} : {}),
      txnIds: all.map(t => t.id),
    })
  }
  return found.sort((a, b) => Number(b.active) - Number(a.active) || b.yearly - a.yearly)
}

/** Charges expected in the `days` after the statement ends, soonest first. */
export function upcoming(recurring: Recurring[], endDay: Day, days = 30): {day: Day; label: string; amount: Cents; merchant: string}[] {
  const out: {day: Day; label: string; amount: Cents; merchant: string}[] = []
  for (const r of recurring) {
    if (!r.active) continue
    const rhythm = RHYTHMS.find(x => x.cadence === r.cadence)!
    let day = r.nextDay
    // Overdue by a few days still means "any day now".
    if (day <= endDay) day = endDay + 1
    while (day <= endDay + days) {
      out.push({day, label: r.label, amount: r.typical, merchant: r.merchant})
      day = addCadence(day, rhythm)
    }
  }
  return out.sort((a, b) => a.day - b.day)
}
