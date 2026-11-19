import {canonical} from './classify.ts'
import {cleanMerchant, labelFor} from './clean.ts'
import {guessOrder, parseDate} from './dates.ts'
import type {Cents, ImportResult, Txn} from './types.ts'

/** Splits delimited text into rows of cells, honouring quotes and doubled quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

export function guessDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 12).join('\n')
  let best = ','
  let bestCount = -1
  for (const d of [',', ';', '\t', '|']) {
    const count = head.split(d).length - 1
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/**
 * Reads a money cell: "$1,234.56", "-12.30", "(45.00)", "45.00 DR", "1.234,56", "12,5".
 * Returns whole cents, or null when the cell holds no number.
 */
export function parseAmount(cell: string): Cents | null {
  let s = cell.trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/\b(dr|debit)\b/i.test(s)) negative = true
  if (/-/.test(s)) negative = true
  s = s.replace(/[^\d.,]/g, '')
  if (!/\d/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let decimalAt = -1
  if (lastDot >= 0 && lastComma >= 0) decimalAt = Math.max(lastDot, lastComma)
  else if (lastComma >= 0) {
    // "12,50" is a decimal comma; "1,250" is a thousands comma.
    decimalAt = s.length - lastComma - 1 === 3 && s.indexOf(',') === lastComma && s.length > 4 ? -1 : s.length - lastComma - 1 <= 2 ? lastComma : -1
  } else if (lastDot >= 0) {
    // "1.250" with a single dot and three digits after it is ambiguous; banks that write
    // dollars this way are far more common than those using a thousands dot alone.
    decimalAt = lastDot
  }
  const whole = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/[.,]/g, '')
  const frac = decimalAt >= 0 ? s.slice(decimalAt + 1).replace(/[.,]/g, '') : ''
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isFinite(cents)) return null
  return negative ? -cents : cents
}

const DATE_HEADS = /^(date|posted|posting date|post date|transaction date|trans(action)?\.? ?date|trans date|booking date|value date|effective date)$/i
const DESC_HEADS = /(description|details?|memo|narrative|payee|merchant|name|transaction|particulars|reference|text)/i
const AMOUNT_HEADS = /^(amount|amt|value|transaction amount|amount \(?usd\)?|amount usd)$/i
const DEBIT_HEADS = /(debit|withdrawal|money out|paid out|outflow|charge|spent)/i
const CREDIT_HEADS = /(credit|deposit|money in|paid in|inflow|received)/i
const SKIP_HEADS = /(balance|running|check ?(no|number|#)|card ?(no|number)|account|category|type|status|currency)/i

/** True for a date in either day-first or month-first order; the order is settled later. */
function isDate(cell: string): boolean {
  return parseDate(cell, 'mdy') !== null || parseDate(cell, 'dmy') !== null
}

function share<T>(items: T[], test: (item: T) => boolean): number {
  return items.length ? items.filter(test).length / items.length : 0
}

interface Mapping {
  header: string[] | null
  date: number
  description: number
  amount: number
  debit: number
  credit: number
}

/** Works out which column is which, from the header when there is one and from the cells otherwise. */
export function mapColumns(rows: string[][]): Mapping | null {
  if (rows.length < 2) return null
  const width = Math.max(...rows.map(r => r.length))
  const first = rows[0]!
  const hasHeader = share(first, c => isDate(c) || (parseAmount(c) !== null && /\d/.test(c) && !/[a-z]{3}/i.test(c))) === 0
  const body = hasHeader ? rows.slice(1) : rows
  const sample = body.slice(0, 200)
  const col = (i: number) => sample.map(r => (r[i] ?? '').trim())
  const head = (i: number) => (hasHeader ? (first[i] ?? '').trim() : '')

  let date = -1
  let description = -1
  let amount = -1
  let debit = -1
  let credit = -1
  const dateScore: number[] = []
  const moneyScore: number[] = []
  const textScore: number[] = []
  for (let i = 0; i < width; i++) {
    const cells = col(i)
    const filled = cells.filter(Boolean)
    dateScore[i] = share(filled, isDate) * (filled.length ? 1 : 0)
    moneyScore[i] = share(filled, c => /^[\s$€£()+\-.,\d]*\d[\s$€£()+\-.,\d]*(cr|dr)?$/i.test(c) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(c))
    const avgLetters = filled.reduce((sum, c) => sum + (c.match(/[a-z]/gi)?.length ?? 0), 0) / (filled.length || 1)
    textScore[i] = filled.length / (cells.length || 1) > 0.6 ? avgLetters : 0
  }
  for (let i = 0; i < width; i++) {
    const h = head(i)
    if (date < 0 && DATE_HEADS.test(h) && dateScore[i]! > 0.6) date = i
    if (amount < 0 && AMOUNT_HEADS.test(h) && moneyScore[i]! > 0.6) amount = i
    if (debit < 0 && DEBIT_HEADS.test(h) && !SKIP_HEADS.test(h.replace(/debit|credit/gi, '')) && moneyScore[i]! > 0.5) debit = i
    else if (credit < 0 && CREDIT_HEADS.test(h) && !SKIP_HEADS.test(h.replace(/debit|credit/gi, '')) && moneyScore[i]! > 0.5) credit = i
  }
  if (date < 0) date = dateScore.findIndex(s => s > 0.8)
  if (date < 0) return null
  const descCandidates = [...Array(width).keys()].filter(i => i !== date && dateScore[i]! < 0.5 && moneyScore[i]! < 0.5)
  const named = descCandidates.filter(i => DESC_HEADS.test(head(i)) && !SKIP_HEADS.test(head(i)))
  const pool = named.length ? named : descCandidates.filter(i => !SKIP_HEADS.test(head(i)))
  description = (pool.length ? pool : descCandidates).reduce((best, i) => (best < 0 || textScore[i]! > textScore[best]! ? i : best), -1)
  if (description < 0) return null
  if (amount < 0 && (debit < 0 || credit < 0)) {
    // No usable header: the first money column that is not a running balance.
    const money = [...Array(width).keys()].filter(i => i !== date && i !== description && moneyScore[i]! > 0.8 && !SKIP_HEADS.test(head(i)))
    if (debit >= 0 || credit >= 0) {
      // A lone "Debit" or "Credit" column: treat it as the amount.
      amount = debit >= 0 ? debit : credit
      debit = -1
      credit = -1
    } else if (money.length) amount = money[0]!
  }
  if (amount < 0 && (debit < 0 || credit < 0)) return null
  if (debit >= 0 && credit >= 0) amount = -1
  return {header: hasHeader ? first : null, date, description, amount, debit, credit}
}

const INCOME_WORDS = /(payroll|direct dep|salary|deposit|refund|reversal|interest paid|cashback|cash back|zelle from|venmo cashout|transfer from|tax ref)/i

/** Reads a whole statement file. Never throws: unreadable lines are reported in `skipped`. */
export function importStatement(text: string): ImportResult {
  const rows = parseDelimited(text, guessDelimiter(text))
  const map = mapColumns(rows)
  if (!map) {
    return {txns: [], skipped: [{line: 1, why: 'Could not find a date column, a description column and an amount column.'}], columns: {date: '', description: '', amount: ''}, flipped: false}
  }
  const body = map.header ? rows.slice(1) : rows
  const offset = map.header ? 2 : 1
  const order = guessOrder(body.map(r => r[map.date] ?? ''))
  const txns: Txn[] = []
  const skipped: ImportResult['skipped'] = []
  body.forEach((r, i) => {
    const day = parseDate(r[map.date] ?? '', order)
    const raw = (r[map.description] ?? '').replace(/\s+/g, ' ').trim()
    let amount: Cents | null
    if (map.amount >= 0) amount = parseAmount(r[map.amount] ?? '')
    else {
      const out = parseAmount(r[map.debit] ?? '')
      const into = parseAmount(r[map.credit] ?? '')
      amount = out !== null && out !== 0 ? -Math.abs(out) : into !== null ? Math.abs(into) : out
    }
    if (day === null) return void skipped.push({line: i + offset, why: `No readable date in "${(r[map.date] ?? '').slice(0, 20)}".`})
    if (amount === null) return void skipped.push({line: i + offset, why: 'No readable amount.'})
    if (!raw) return void skipped.push({line: i + offset, why: 'No description.'})
    if (amount === 0) return
    const named = canonical(cleanMerchant(raw))
    txns.push({id: 0, day, raw, merchant: named.merchant, label: named.label ?? labelFor(named.merchant), amount})
  })

  // Card statements list purchases as positive numbers. Spot that and turn the signs round,
  // so that everywhere else in the app "negative" means money out.
  let flipped = false
  if (map.amount >= 0 && txns.length) {
    const positives = txns.filter(t => t.amount > 0)
    const positiveShare = positives.length / txns.length
    const incomeLooking = share(positives, t => INCOME_WORDS.test(t.raw))
    if (positiveShare > 0.7 && incomeLooking < 0.5) {
      flipped = true
      for (const t of txns) t.amount = -t.amount
    }
  }

  txns.sort((a, b) => a.day - b.day)
  txns.forEach((t, i) => (t.id = i))
  const name = (i: number) => (i < 0 ? '' : map.header ? (map.header[i] ?? '').trim() : `column ${i + 1}`)
  return {
    txns,
    skipped,
    columns: {date: name(map.date), description: name(map.description), amount: map.amount >= 0 ? name(map.amount) : `${name(map.debit)} / ${name(map.credit)}`},
    flipped,
  }
}

function csvCell(value: string): string {
  // A description that starts like a formula ("=HYPERLINK(...)") would run when the saved file is
  // opened in a spreadsheet. A leading apostrophe makes it plain text. Plain negative numbers stay.
  const safe = /^[=+@\t\r]/.test(value) || (/^-/.test(value) && !/^-\d[\d.,]*$/.test(value)) ? `'${value}` : value
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map(r => r.map(c => csvCell(String(c))).join(',')).join('\n') + '\n'
}
