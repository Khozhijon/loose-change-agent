import {category, CATEGORIES} from './categories.ts'
import {formatDay, fromDay, monthIndex, monthLabel, monthStart, MONTH_NAMES, toDay} from './dates.ts'
import {money, plural} from './money.ts'
import type {CategoryId, Day, Recurring, Txn, Verdict} from './types.ts'

export type Metric = 'sum' | 'count' | 'average' | 'biggest'

export interface Parsed {
  metric: Metric
  range: {from: Day; to: Day; label: string} | null
  /** What the question is about once the question words and the dates are taken out. */
  subject: string
  /** Set when the subject is one of a few fixed ideas that need no model. */
  fixed: 'everything' | 'income' | 'fees' | 'subscriptions' | null
}

const FILLER = new Set(
  'how much many did do does i i\'ve have has had we my me the a an on for at in to of is was were are spend spent spending pay paid paying cost costs total totals totalled go went goes money cash and or what whats what\'s which show list tell give me all any per each this that it altogether overall with from by get got buy bought buying use used purchases purchase payments payment charges charge transactions transaction time times often number amount there'.split(' '),
)

/** Reads the time part of a question, relative to the last day of the statement. */
function findRange(q: string, endDay: Day): {range: Parsed['range']; rest: string} {
  const end = fromDay(endDay)
  const thisMonth = monthIndex(endDay)
  const span = (from: Day, to: Day, label: string, cut: RegExp) => ({range: {from, to, label}, rest: q.replace(cut, ' ')})
  let m: RegExpExecArray | null

  if ((m = /\b(?:last|past|previous)\s+(\d+|two|three|four|six)\s+(day|week|month)s?\b/.exec(q))) {
    const words: Record<string, number> = {two: 2, three: 3, four: 4, six: 6}
    const n = words[m[1]!] ?? Number(m[1])
    if (m[2] === 'month') {
      const from = monthStart(thisMonth - n + 1)
      return span(from, endDay, `the last ${n} months`, new RegExp(m[0]))
    }
    const days = n * (m[2] === 'week' ? 7 : 1)
    return span(endDay - days + 1, endDay, `the last ${plural(n, m[2]!)}`, new RegExp(m[0]))
  }
  if ((m = /\b(?:this|current)\s+month\b/.exec(q))) return span(monthStart(thisMonth), endDay, monthLabel(thisMonth, true), new RegExp(m[0]))
  if ((m = /\b(?:last|previous)\s+month\b/.exec(q))) return span(monthStart(thisMonth - 1), monthStart(thisMonth) - 1, monthLabel(thisMonth - 1, true), new RegExp(m[0]))
  if ((m = /\b(?:this|past|last)\s+week\b/.exec(q))) return span(endDay - 6, endDay, 'the last 7 days', new RegExp(m[0]))
  if ((m = /\b(?:this year|in (20\d\d))\b/.exec(q))) {
    const y = m[1] ? Number(m[1]) : end.y
    return span(toDay(y, 1, 1), toDay(y, 12, 31), String(y), new RegExp(m[0]))
  }
  const names = MONTH_NAMES.map(n => n.toLowerCase())
  const monthWord = `(${names.join('|')}|${names.map(n => n.slice(0, 3)).join('|')})`
  if ((m = new RegExp(`\\bsince\\s+${monthWord}\\b`).exec(q))) {
    let idx = end.y * 12 + names.findIndex(n => n.startsWith(m![1]!.slice(0, 3)))
    if (idx > thisMonth) idx -= 12
    return span(monthStart(idx), endDay, `since ${monthLabel(idx, true)}`, new RegExp(m[0]))
  }
  if ((m = new RegExp(`\\b(?:in|during|for)?\\s*${monthWord}\\b(?:\\s+(20\\d\\d))?`).exec(q))) {
    const month = names.findIndex(n => n.startsWith(m![1]!.slice(0, 3)))
    // "may" is also a verb; only read it as a month after "in" or with a year.
    if (m[1] !== 'may' || /\b(in|during|for)\s+may\b/.test(m[0]) || m[2]) {
      let idx = (m[2] ? Number(m[2]) : end.y) * 12 + month
      if (!m[2] && idx > thisMonth) idx -= 12
      return span(monthStart(idx), monthStart(idx + 1) - 1, monthLabel(idx, true), new RegExp(m[0]))
    }
  }
  return {range: null, rest: q}
}

export function parseQuestion(question: string, endDay: Day): Parsed {
  const q = ` ${question.toLowerCase().replace(/[?!.,"]/g, ' ').replace(/\s+/g, ' ')} `
  let metric: Metric = 'sum'
  if (/\b(how many|how often|number of|count)\b/.test(q)) metric = 'count'
  else if (/\b(average|avg|typical|usually|on average)\b/.test(q)) metric = 'average'
  else if (/\b(biggest|largest|most expensive|highest|max)\b/.test(q)) metric = 'biggest'
  const {range, rest} = findRange(q, endDay)
  const subject = rest
    .replace(/\b(how many|how often|number of|count|average|avg|typical|usually|on average|biggest|largest|most expensive|highest|max|single)\b/g, ' ')
    .split(' ')
    .filter(w => w && !FILLER.has(w))
    .join(' ')
    .trim()
  let fixed: Parsed['fixed'] = null
  if (!subject || /^(everything|anything|stuff|things|expenses|spending|outgoings)$/.test(subject)) fixed = 'everything'
  else if (/^(income|earn|earned|earnings|salary|paycheck|paychecks|wages|come in|came in|coming in|received|deposits?)$/.test(subject)) fixed = 'income'
  else if (/^(bank )?(fees?|charges)$/.test(subject)) fixed = 'fees'
  else if (/^(subscriptions?|subs|memberships?|recurring|regular (charges|payments))$/.test(subject)) fixed = 'subscriptions'
  return {metric, range, subject, fixed}
}

export interface Target {
  /** How the subject was understood, in words fit to show. */
  label: string
  test: (t: Txn, v: Verdict) => boolean
}

/**
 * Finds what a subject means without the model: a fixed idea, a category named outright, or
 * merchants whose names contain the words. Returns null when the model has to decide.
 */
export function targetWithoutModel(parsed: Parsed, txns: Txn[], recurring: Recurring[]): Target | null {
  if (parsed.fixed === 'everything') return {label: 'everything you spent', test: (t, v) => t.amount < 0 && category(v.category).spending}
  if (parsed.fixed === 'income') return {label: 'money coming in', test: t => t.amount > 0}
  if (parsed.fixed === 'fees') return {label: 'bank fees', test: (t, v) => t.amount < 0 && v.category === 'fees'}
  if (parsed.fixed === 'subscriptions') {
    const ids = new Set(recurring.filter(r => r.category === 'subscriptions').flatMap(r => r.txnIds))
    return {label: 'subscriptions', test: (t, v) => t.amount < 0 && (ids.has(t.id) || v.category === 'subscriptions')}
  }
  const subject = parsed.subject
  const named = CATEGORIES.find(c => c.label.toLowerCase() === subject || c.id.replace('_', ' ') === subject)
  if (named) return targetForCategory(named.id)
  const words = subject.split(' ').filter(w => w.length >= 3)
  if (words.length) {
    const hits = new Set<string>()
    for (const t of txns) {
      const name = ` ${t.merchant} `
      if (words.every(w => name.includes(` ${w}`))) hits.add(t.merchant)
    }
    if (hits.size) {
      const labels = [...hits].slice(0, 3).join(', ')
      return {label: hits.size > 3 ? `${labels} and ${hits.size - 3} more` : labels, test: t => t.amount < 0 && hits.has(t.merchant)}
    }
  }
  return null
}

export function targetForCategory(id: CategoryId): Target {
  return {label: category(id).label, test: id === 'income' ? t => t.amount > 0 : (t, v) => t.amount < 0 && v.category === id}
}

export interface Answer {
  text: string
  detail: string
  txnIds: number[]
}

export function answer(parsed: Parsed, target: Target, txns: Txn[], verdicts: Verdict[]): Answer {
  const rows = txns.filter(t => (!parsed.range || (t.day >= parsed.range.from && t.day <= parsed.range.to)) && target.test(t, verdicts[t.id]!))
  const when = parsed.range ? (/^(since|the last)\b/.test(parsed.range.label) ? ` ${parsed.range.label.replace(/^the last/, 'in the last')}` : ` in ${parsed.range.label}`) : ' in this statement'
  const about = target.label
  if (!rows.length) return {text: `Nothing for ${about}${when}.`, detail: 'No lines matched. Try a merchant name or a category.', txnIds: []}
  const amounts = rows.map(t => Math.abs(t.amount))
  const total = amounts.reduce((a, b) => a + b, 0)
  const top = new Map<string, number>()
  for (const t of rows) top.set(t.label, (top.get(t.label) ?? 0) + Math.abs(t.amount))
  const leaders = [...top].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, sum]) => `${label} ${money(sum)}`).join(' · ')
  const detail = `${plural(rows.length, 'line')}${top.size > 1 ? `. Most went to: ${leaders}` : ''}`
  const txnIds = rows.map(t => t.id)
  if (parsed.metric === 'count') return {text: `${plural(rows.length, 'payment')} for ${about}${when}, ${money(total)} in all.`, detail, txnIds}
  if (parsed.metric === 'average') return {text: `About ${money(Math.round(total / rows.length))} a time for ${about}${when}.`, detail: `${plural(rows.length, 'line')}, ${money(total)} in all.`, txnIds}
  if (parsed.metric === 'biggest') {
    const big = rows.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
    return {text: `The biggest was ${money(Math.abs(big.amount))} at ${big.label} on ${formatDay(big.day)}.`, detail, txnIds: [big.id]}
  }
  return {text: `${money(total)} for ${about}${when}.`, detail, txnIds}
}
