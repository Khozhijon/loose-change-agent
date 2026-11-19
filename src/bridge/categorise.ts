// A pure function other agent sites can call: bank statement wording in, categories out.
// It runs in the caller's visitor's browser (inside this site's bridge frame). It keeps nothing.
import {category, CATEGORY_IDS} from '../core/categories.ts'
import {byRule, canonical} from '../core/classify.ts'
import {cleanMerchant, labelFor} from '../core/clean.ts'

export const MAX_ITEMS = 40
export const MAX_LENGTH = 140

export interface Item {
  description: string
  usd?: number
}

export interface Placed {
  input: string
  merchant: string
  category: string
  categoryLabel: string
  confidence: number
  kind?: string
  needsReview: boolean
  why: string
}

/** Place each line with Loose Change's rules and known merchants. Lines it cannot place come back as needsReview. */
export function categorise(items: Item[]): Placed[] {
  return items.slice(0, MAX_ITEMS).map(item => {
    const raw = String(item.description ?? '').slice(0, MAX_LENGTH).replace(/\s+/g, ' ').trim()
    const named = canonical(cleanMerchant(raw))
    const label = named.label ?? labelFor(named.merchant)
    // A line with no amount is treated as money out, which is what most statement lines are.
    const cents = typeof item.usd === 'number' && Number.isFinite(item.usd) ? Math.round(item.usd * 100) : -100
    const verdict = raw ? byRule(named.merchant, raw, cents) : null
    if (!verdict) {
      return {input: raw, merchant: label, category: 'other', categoryLabel: category('other').label, confidence: 0, needsReview: true, why: 'Not a merchant or wording the rules know. Decide from the name, or ask the visitor.'}
    }
    const why = verdict.reason.how === 'known' ? `Known merchant: ${verdict.reason.example}` : verdict.reason.how === 'rule' ? verdict.reason.rule : 'Matched'
    return {input: raw, merchant: label, category: verdict.category, categoryLabel: category(verdict.category).label, confidence: verdict.confidence, ...(verdict.kind ? {kind: verdict.kind} : {}), needsReview: false, why}
  })
}

export const CATEGORY_LIST = CATEGORY_IDS
