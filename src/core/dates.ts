import type {Day} from './types.ts'

const MS_DAY = 86_400_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function toDay(year: number, month: number, date: number): Day {
  return Math.round(Date.UTC(year, month - 1, date) / MS_DAY)
}

export function fromDay(day: Day): {y: number; m: number; d: number; dow: number} {
  const t = new Date(day * MS_DAY)
  return {y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay()}
}

/** A month as year * 12 + (month - 1), handy for ranges and chart columns. */
export function monthIndex(day: Day): number {
  const {y, m} = fromDay(day)
  return y * 12 + (m - 1)
}

export function monthStart(index: number): Day {
  return toDay(Math.floor(index / 12), (index % 12) + 1, 1)
}

export function monthLabel(index: number, long = false): string {
  const name = MONTH_NAMES[index % 12]!
  return `${long ? name : name.slice(0, 3)} ${Math.floor(index / 12)}`
}

export function formatDay(day: Day, withYear = true): string {
  const {y, m, d} = fromDay(day)
  return `${d} ${MONTH_NAMES[m - 1]!.slice(0, 3)}${withYear ? ` ${y}` : ''}`
}

export function isoDay(day: Day): string {
  const {y, m, d} = fromDay(day)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function valid(y: number, m: number, d: number): boolean {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false
  const back = fromDay(toDay(y, m, d))
  return back.m === m && back.d === d
}

function fullYear(y: number): number {
  return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y
}

export type DateOrder = 'mdy' | 'dmy'

/**
 * Reads one date cell. `order` settles 03/04/2026, which is March in the US and April
 * almost everywhere else; the importer works it out from the whole column.
 */
export function parseDate(cell: string, order: DateOrder = 'mdy'): Day | null {
  const s = cell.trim().replace(/^"|"$/g, '')
  if (!s) return null
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return valid(y, mo, d) ? toDay(y, mo, d) : null
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(s)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = fullYear(Number(m[3]))
    const [mo, d] = order === 'mdy' ? [a, b] : [b, a]
    return valid(y, mo, d) ? toDay(y, mo, d) : null
  }
  // 5 Jan 2026, 05-Jan-26, Jan 5, 2026, January 5 2026
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})\b/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1
    const y = fullYear(Number(m[3]))
    return mo && valid(y, mo, Number(m[1])) ? toDay(y, mo, Number(m[1])) : null
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1
    return mo && valid(Number(m[3]), mo, Number(m[2])) ? toDay(Number(m[3]), mo, Number(m[2])) : null
  }
  return null
}

/** Looks at a whole column of dd/mm or mm/dd dates and says which it is. */
export function guessOrder(cells: string[]): DateOrder {
  let firstOver12 = 0
  let secondOver12 = 0
  for (const cell of cells) {
    const m = /^\s*"?(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(cell)
    if (!m) continue
    if (Number(m[1]) > 12) firstOver12++
    if (Number(m[2]) > 12) secondOver12++
  }
  return firstOver12 > secondOver12 ? 'dmy' : 'mdy'
}
