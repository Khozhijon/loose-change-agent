import {category} from './categories.ts'
import {monthIndex} from './dates.ts'
import type {CategoryId, Cents, Day, Txn, Verdict} from './types.ts'

export interface Summary {
  startDay: Day
  endDay: Day
  /** Month indexes (year * 12 + month) covered, in order. */
  months: number[]
  /** Spending per month and category, positive cents. */
  byMonth: Map<number, Map<CategoryId, Cents>>
  /** Spending per category over the whole statement, largest first. */
  byCategory: {id: CategoryId; total: Cents; count: number}[]
  spent: Cents
  cameIn: Cents
  /** Moved between the user's own accounts or to people; not counted as spending. */
  moved: Cents
  perDay: Cents
}

export function summarise(txns: Txn[], verdicts: Verdict[]): Summary {
  const startDay = txns.length ? txns[0]!.day : 0
  const endDay = txns.length ? txns[txns.length - 1]!.day : 0
  const months: number[] = []
  for (let m = monthIndex(startDay); m <= monthIndex(endDay); m++) months.push(m)
  const byMonth = new Map<number, Map<CategoryId, Cents>>(months.map(m => [m, new Map()]))
  const totals = new Map<CategoryId, {total: Cents; count: number}>()
  let spent = 0
  let cameIn = 0
  let moved = 0
  for (const t of txns) {
    const c = verdicts[t.id]!.category
    if (t.amount > 0) {
      cameIn += t.amount
      continue
    }
    if (!category(c).spending) {
      moved -= t.amount
      continue
    }
    spent -= t.amount
    const month = byMonth.get(monthIndex(t.day))!
    month.set(c, (month.get(c) ?? 0) - t.amount)
    const total = totals.get(c) ?? {total: 0, count: 0}
    total.total -= t.amount
    total.count++
    totals.set(c, total)
  }
  const byCategory = [...totals].map(([id, v]) => ({id, ...v})).sort((a, b) => b.total - a.total)
  const days = Math.max(1, endDay - startDay + 1)
  return {startDay, endDay, months, byMonth, byCategory, spent, cameIn, moved, perDay: Math.round(spent / days)}
}
