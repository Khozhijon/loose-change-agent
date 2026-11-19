import {BANK, type BankEntry} from './bank.ts'
import type {CategoryId, Cents, Verdict} from './types.ts'

/** Rows whose confidence falls below this are put in front of the user for a look. */
export const REVIEW_BELOW = 0.5
/** Below this the model's guess is not worth showing; the row is filed under Other. */
const GIVE_UP_BELOW = 0.2
const NEIGHBOURS = 6
/** Similarity under this adds nothing to a category's vote. */
const FLOOR = 0.3

export interface Taught {
  text: string
  category: CategoryId
  vec: Float32Array | null
}

/**
 * Wording banks use for their own charges. A bare "fee" is not enough: gyms, exam centres and
 * airlines all bill "fees", and those belong to the merchant's own category.
 */
const FEE = /\b(overdraft|nsf|insufficient funds|returned item|service charge|finance charge|interest charged?|(atm|maintenance|service|monthly|account|late|late payment|foreign transaction|intl transaction|international transaction|currency conversion|wire|wire transfer|annual|cash advance|paper statement|stop payment|transaction) fees?)\b/
/** A known merchant scores this much less as a model neighbour than a plain description does. */
const BRAND_DISCOUNT = 0.07
const FEE_KINDS: [RegExp, string][] = [
  [/\bwire\b/, 'wire fee'],
  [/\batm\b/, 'ATM fee'],
  [/(foreign|intl|international|currency|fx|conversion)/, 'foreign transaction fee'],
  [/\b(overdraft|nsf|insufficient funds|returned item)\b/, 'overdraft fee'],
  [/\blate\b/, 'late fee'],
  [/(maintenance|monthly|service|account|statement)/, 'account fee'],
  [/(interest|finance)/, 'interest'],
]
const CASH = /\batm\b.*\b(withdraw\w*|w\/d|cash)\b|\bcash withdrawal\b|\b(withdraw\w*|w\/d)\b.*\batm\b/
const MONEY_IN_KINDS: [RegExp, string][] = [
  [/(refund|return|reversal|credit adj|chargeback|rebate)/, 'refund'],
  [/(payroll|salary|direct dep|paycheck|\badp\b|gusto|paychex|wages|stipend)/, 'pay'],
  [/(interest)/, 'interest'],
  [/(zelle|venmo|cash app|cashapp|paypal|transfer|xfer|wise|remitly)/, 'from people or other accounts'],
  [/(deposit)/, 'deposit'],
]

function tokens(text: string): string[] {
  return text.replace(/['.]/g, '').replace(/-/g, ' ').split(/\s+/).filter(Boolean)
}

interface Known {
  entry: BankEntry
  words: string[]
}

const KNOWN: Known[] = BANK.filter(e => e.match !== 'model').map(entry => ({entry, words: tokens(entry.text)}))

/**
 * Word-for-word lookup. Statement lines are often cut short ("blue bottle cof"), so the
 * final word of the line may be the start of the entry's final word.
 */
export function findKnown(merchant: string): BankEntry | null {
  const m = tokens(merchant)
  let best: Known | null = null
  for (const k of KNOWN) {
    const w = k.words
    if (k.entry.match === 'whole') {
      if (m.length === w.length && m.every((t, i) => t === w[i])) {
        if (!best || k.entry.text.length > best.entry.text.length) best = k
      }
      continue
    }
    for (let i = 0; i + w.length <= m.length; i++) {
      let ok = true
      for (let j = 0; j < w.length && ok; j++) {
        const mt = m[i + j]!
        const wt = w[j]!
        const lastOfLine = i + j === m.length - 1
        if (mt === wt) continue
        if (j === w.length - 1 && lastOfLine && w.length > 1 && mt.length >= 3 && wt.startsWith(mt)) continue
        ok = false
      }
      if (ok) {
        if (!best || k.entry.text.length > best.entry.text.length) best = k
        break
      }
    }
  }
  return best ? best.entry : null
}

/** Names to show for known merchants whose statement spelling is ugly. */
const PRETTY: Record<string, string> = {
  'amzn mktp': 'Amazon', amzn: 'Amazon', amazon: 'Amazon', wholefds: 'Whole Foods', nytimes: 'New York Times', openai: 'OpenAI',
  chatgpt: 'ChatGPT', 'mbta charlie': 'MBTA', mcdonalds: "McDonald's", 'apple bill': 'Apple services', 'uber trip': 'Uber',
  'lyft ride': 'Lyft', 'costco whse': 'Costco', disneyplus: 'Disney Plus', youtubepremium: 'YouTube Premium', icloud: 'iCloud',
  'hbo max': 'HBO Max', 'at&t': 'AT&T', 'pg&e': 'PG&E', cvs: 'CVS', 'h mart': 'H Mart', hmart: 'H Mart', tmobile: 'T-Mobile',
  ubereats: 'Uber Eats', 'trader joes': "Trader Joe's", wendys: "Wendy's", dominos: "Domino's", 'credit crd autopay': 'Credit card autopay',
  'online transfer to': 'Transfer to savings', 'steam games': 'Steam', steampowered: 'Steam', coned: 'Con Edison', github: 'GitHub',
  linkedin: 'LinkedIn', youtube: 'YouTube', paypal: 'PayPal', doordash: 'DoorDash', grubhub: 'Grubhub', jetblue: 'JetBlue',
  airbnb: 'Airbnb', ikea: 'IKEA', 'zoom us': 'Zoom', nordvpn: 'NordVPN', 'wal-mart': 'Walmart', cashapp: 'Cash App',
}

/**
 * The name to group and show a merchant by. A known merchant collapses to its listed name, so
 * "starbucks store" and "starbucks" are one merchant and every DoorDash order sits together.
 */
export function canonical(merchant: string): {merchant: string; label: string | null} {
  const known = findKnown(merchant)
  if (!known || known.category === 'fees' || known.category === 'income' || known.category === 'cash') return {merchant, label: null}
  const pretty = PRETTY[known.text]
  return {merchant: known.text, label: pretty ?? null}
}

/** The part of a verdict that needs no model: bank fees, cash, money in, known merchants. */
export function byRule(merchant: string, raw: string, amount: Cents): Verdict | null {
  const text = `${raw.toLowerCase()} ${merchant}`
  if (amount > 0) {
    const kind = MONEY_IN_KINDS.find(([re]) => re.test(text))?.[1] ?? 'other money in'
    return {category: 'income', confidence: 0.95, reason: {how: 'rule', rule: 'Money coming in'}, kind}
  }
  const known = findKnown(merchant)
  if (FEE.test(text) && (!known || known.category === 'fees')) {
    const kind = FEE_KINDS.find(([re]) => re.test(text))?.[1] ?? 'bank fee'
    return {category: 'fees', confidence: 0.97, reason: {how: 'rule', rule: `Wording of a bank charge (${kind})`}, kind}
  }
  if (CASH.test(text)) return {category: 'cash', confidence: 0.97, reason: {how: 'rule', rule: 'Cash withdrawal wording'}}
  if (known) {
    return {category: known.category, confidence: 0.97, reason: {how: 'known', example: known.text}, ...(known.kind ? {kind: known.kind} : {})}
  }
  return null
}

function dot(a: Float32Array, aAt: number, b: Float32Array, dim: number): number {
  let sum = 0
  for (let i = 0; i < dim; i++) sum += a[aAt + i]! * b[i]!
  return sum
}

export class Classifier {
  readonly dim: number
  private readonly bankVecs: Float32Array | null
  taught: Taught[] = []

  /** `bankVecs` holds one unit-length vector per BANK entry, in order. Pass null to run on rules alone. */
  constructor(bankVecs: Float32Array | null, dim = 384) {
    if (bankVecs && bankVecs.length !== BANK.length * dim) {
      throw new Error(`Example vectors do not match the example list (${bankVecs.length} values for ${BANK.length} examples).`)
    }
    this.bankVecs = bankVecs
    this.dim = dim
  }

  /** Remembers a correction. It wins outright for that merchant and pulls similar names with it. */
  teach(text: string, category: CategoryId, vec: Float32Array | null): void {
    this.taught = this.taught.filter(t => t.text !== text)
    this.taught.push({text, category, vec})
  }

  forget(text: string): void {
    this.taught = this.taught.filter(t => t.text !== text)
  }

  classify(merchant: string, raw: string, amount: Cents, vec: Float32Array | null): Verdict {
    const exact = this.taught.find(t => t.text === merchant)
    if (exact) return {category: exact.category, confidence: 1, reason: {how: 'taught', example: exact.text, score: 1}}
    const rule = byRule(merchant, raw, amount)
    if (rule) return rule
    if (!vec || !this.bankVecs) return {category: 'other', confidence: 0, reason: {how: 'rule', rule: 'Not recognised, and the model is not loaded'}}

    // A taught merchant with nearly the same name settles it ("sq blue bottle" vs "blue bottle cof").
    let taughtBest: {t: Taught; score: number} | null = null
    for (const t of this.taught) {
      if (!t.vec) continue
      const score = dot(t.vec, 0, vec, this.dim)
      if (!taughtBest || score > taughtBest.score) taughtBest = {t, score}
    }
    if (taughtBest && taughtBest.score >= 0.78) {
      return {category: taughtBest.t.category, confidence: Math.min(0.99, taughtBest.score), reason: {how: 'taught', example: taughtBest.t.text, score: taughtBest.score}}
    }

    const top: {text: string; category: CategoryId; score: number; kind?: string}[] = []
    const push = (text: string, category: CategoryId, score: number, kind?: string) => {
      if (top.length === NEIGHBOURS && score <= top[NEIGHBOURS - 1]!.score) return
      top.push({text, category, score, ...(kind ? {kind} : {})})
      top.sort((a, b) => b.score - a.score)
      if (top.length > NEIGHBOURS) top.pop()
    }
    for (let i = 0; i < BANK.length; i++) {
      const e = BANK[i]!
      // Money-in examples only make sense for money coming in, which rules have already handled.
      if (e.category === 'income') continue
      // A brand name that merely looks like this one ("muji" for "mubi") says little about what
      // the shop sells; a description that sits close ("espresso bar") says a lot.
      const score = dot(this.bankVecs, i * this.dim, vec, this.dim) - (e.match === 'model' ? 0 : BRAND_DISCOUNT)
      push(e.text, e.category, score, e.kind)
    }
    // What the user taught counts a little more than what shipped with the app.
    for (const t of this.taught) if (t.vec) push(t.text, t.category, dot(t.vec, 0, vec, this.dim) + 0.05)

    const votes = new Map<CategoryId, number>()
    // Squared, so one close neighbour outweighs several loose ones.
    for (const n of top) votes.set(n.category, (votes.get(n.category) ?? 0) + Math.max(0, n.score - FLOOR) ** 2)
    let best: CategoryId = 'other'
    let bestVote = 0
    let total = 0
    for (const [c, v] of votes) {
      total += v
      if (v > bestVote) {
        best = c
        bestVote = v
      }
    }
    const lead = top.find(n => n.category === best)
    const strength = Math.min(1, Math.max(0, ((lead?.score ?? 0) - FLOOR) / 0.4))
    const agreement = total > 0 ? bestVote / total : 0
    const confidence = Math.round(strength * (0.45 + 0.55 * agreement) * 100) / 100
    const neighbours = top.slice(0, 3).map(({text, category, score}) => ({text, category, score: Math.round(score * 100) / 100}))
    if (confidence < GIVE_UP_BELOW) return {category: 'other', confidence, reason: {how: 'model', neighbours}}
    const kind = lead && lead.score >= 0.6 ? lead.kind : undefined
    return {category: best, confidence, reason: {how: 'model', neighbours}, ...(kind ? {kind} : {})}
  }
}
