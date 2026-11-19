import {formatDay} from './dates.ts'
import {money, plural} from './money.ts'
import {perYear} from './recurring.ts'
import type {Alert, Cents, Day, Recurring, Txn, Verdict} from './types.ts'

/** Everyday categories where the same amount twice in a day is normal (two bus taps, two coffees). */
const REPEATS_ARE_NORMAL = new Set(['transport', 'coffee', 'cash', 'transfers', 'fees', 'income'])

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/**
 * Looks for money that is probably leaving by mistake or by neglect. Every alert names the
 * exact lines it is built from, so the user can check it instead of taking it on trust.
 */
export function findAlerts(txns: Txn[], verdicts: Verdict[], recurring: Recurring[], startDay: Day, endDay: Day): Alert[] {
  const alerts: Alert[] = []
  const months = Math.max(1, (endDay - startDay + 1) / 30.4)
  const regular = new Map(recurring.map(r => [r.merchant, r]))

  // Charged twice: same merchant, same amount, at most a day apart.
  const byMerchant = new Map<string, Txn[]>()
  for (const t of txns) {
    if (t.amount >= 0) continue
    const g = byMerchant.get(t.merchant)
    if (g) g.push(t)
    else byMerchant.set(t.merchant, [t])
  }
  const used = new Set<number>()
  for (const [merchant, list] of byMerchant) {
    list.sort((a, b) => a.day - b.day)
    const isRegular = regular.has(merchant)
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!
      const b = list[i]!
      if (used.has(a.id) || a.amount !== b.amount || b.day - a.day > (isRegular ? 3 : 1)) continue
      const category = verdicts[b.id]!.category
      if (!isRegular && (REPEATS_ARE_NORMAL.has(category) || -b.amount < 1000)) continue
      used.add(a.id).add(b.id)
      alerts.push({
        kind: 'duplicate',
        title: `${b.label} charged you twice`,
        detail: `${money(-b.amount)} on ${formatDay(a.day, false)}${b.day === a.day ? ', and the same amount again that day' : ` and again on ${formatDay(b.day, false)}`}. ${isRegular ? 'This is a regular charge that normally comes once.' : 'If you did not buy twice, ask for one back.'}`,
        amount: -b.amount,
        txnIds: [a.id, b.id],
      })
    }
  }

  for (const r of recurring) {
    if (!r.active) continue
    // The price went up.
    if (r.rise) {
      const extra = (r.rise.to - r.rise.from) * perYear(r.cadence)
      alerts.push({
        kind: 'price_rise',
        title: `${r.label} went up`,
        detail: `From ${money(r.rise.from)} to ${money(r.rise.to)} ${r.cadence === 'monthly' ? 'a month' : r.cadence} since ${formatDay(r.rise.day)}. That is ${money(extra)} more a year.`,
        amount: r.rise.to - r.rise.from,
        yearly: extra,
        txnIds: r.txnIds,
      })
    }
    // A trial that turned into a paid plan.
    const first = txns[r.txnIds[0]!]!
    if (r.txnIds.length >= 2 && -first.amount <= 150 && r.typical >= 500) {
      alerts.push({
        kind: 'trial',
        title: `${r.label} trial became a paid plan`,
        detail: `It started at ${money(-first.amount)} on ${formatDay(first.day)} and now takes ${money(r.typical)} ${r.cadence === 'monthly' ? 'a month' : r.cadence}: ${money(r.yearly)} a year if it carries on.`,
        amount: r.typical,
        yearly: r.yearly,
        txnIds: r.txnIds,
      })
    } else if (endDay - r.firstDay <= 75 && r.category === 'subscriptions') {
      alerts.push({
        kind: 'new_recurring',
        title: `New regular charge: ${r.label}`,
        detail: `Started on ${formatDay(r.firstDay)} at ${money(r.typical)} ${r.cadence === 'monthly' ? 'a month' : r.cadence}, which is ${money(r.yearly)} a year.`,
        amount: r.typical,
        yearly: r.yearly,
        txnIds: r.txnIds,
      })
    }
  }

  // Several subscriptions that do the same job.
  const byKind = new Map<string, Recurring[]>()
  for (const r of recurring) {
    if (!r.active || !r.kind || r.category !== 'subscriptions') continue
    const g = byKind.get(r.kind)
    if (g) g.push(r)
    else byKind.set(r.kind, [r])
  }
  for (const [kind, list] of byKind) {
    if (list.length < 2) continue
    const yearly = list.reduce((sum, r) => sum + r.yearly, 0)
    const cheapestOut = yearly - Math.max(...list.map(r => r.yearly))
    alerts.push({
      kind: 'overlap',
      title: `${list.length} ${kind} subscriptions at once`,
      detail: `${list.map(r => r.label).join(', ')} together cost ${money(yearly)} a year. Keeping only the dearest one would free ${money(cheapestOut)}.`,
      amount: Math.round(yearly / 12),
      yearly: cheapestOut,
      txnIds: list.flatMap(r => r.txnIds),
    })
  }

  // Bank fees, one alert per kind of fee.
  const fees = new Map<string, Txn[]>()
  for (const t of txns) {
    const v = verdicts[t.id]!
    if (v.category !== 'fees' || t.amount >= 0) continue
    const kind = v.kind ?? 'bank fee'
    const g = fees.get(kind)
    if (g) g.push(t)
    else fees.set(kind, [t])
  }
  for (const [kind, list] of fees) {
    const total = list.reduce((sum, t) => sum - t.amount, 0)
    const yearly = Math.round((total / months) * 12)
    alerts.push({
      kind: 'fee',
      title: kind.endsWith('interest') ? `${money(total)} in interest` : list.length > 1 ? `${money(total)} in ${kind}s` : `A ${money(total)} ${kind}`,
      detail: `${plural(list.length, 'charge')} in this statement. At this rate that is about ${money(yearly, true)} a year.`,
      amount: total,
      yearly,
      txnIds: list.map(t => t.id),
    })
  }

  // One charge far above what this merchant normally takes.
  for (const [merchant, list] of byMerchant) {
    if (list.length < 5 || regular.has(merchant)) continue
    const usual = median(list.map(t => -t.amount))
    for (const t of list) {
      const paid: Cents = -t.amount
      if (paid >= usual * 4 && paid - usual >= 4000) {
        alerts.push({
          kind: 'unusual',
          title: `Unusually large charge at ${t.label}`,
          detail: `${money(paid)} on ${formatDay(t.day)}. You normally pay about ${money(Math.round(usual))} there.`,
          amount: paid,
          txnIds: [t.id],
        })
      }
    }
  }

  const order: Record<Alert['kind'], number> = {duplicate: 0, trial: 1, price_rise: 2, fee: 3, overlap: 4, new_recurring: 5, unusual: 6}
  return alerts.sort((a, b) => order[a.kind] - order[b.kind] || (b.yearly ?? b.amount) - (a.yearly ?? a.amount))
}

/**
 * The headline figure: what the alerts add up to over a year. Duplicates count once (they are
 * one-off refunds); fees and price rises count at their yearly rate. Overlaps and new charges
 * are left out because whether to keep them is the user's call, not a mistake.
 */
export function looseChange(alerts: Alert[]): Cents {
  let total = 0
  for (const a of alerts) {
    if (a.kind === 'duplicate') total += a.amount
    else if (a.kind === 'fee' || a.kind === 'price_rise') total += a.yearly ?? 0
  }
  return total
}
