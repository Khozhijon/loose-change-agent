/** Money is always whole cents. Negative means money out, positive means money in. */
export type Cents = number

/** A calendar day as days since 1970-01-01 (UTC), so day arithmetic stays exact. */
export type Day = number

export type CategoryId =
  | 'groceries'
  | 'eating_out'
  | 'coffee'
  | 'transport'
  | 'travel'
  | 'housing'
  | 'bills'
  | 'subscriptions'
  | 'shopping'
  | 'health'
  | 'education'
  | 'fun'
  | 'fees'
  | 'transfers'
  | 'cash'
  | 'income'
  | 'other'

/** One line of the statement after import. */
export interface Txn {
  id: number
  day: Day
  /** The description exactly as the bank wrote it. */
  raw: string
  /** Cleaned merchant name used for grouping and for the model, lower case. */
  merchant: string
  /** The same name in a form fit to show. */
  label: string
  amount: Cents
}

export type Reason =
  /** The cleaned name matched a known merchant word for word. */
  | {how: 'known'; example: string}
  /** Chosen by closeness in the model's embedding space. */
  | {how: 'model'; neighbours: {text: string; category: CategoryId; score: number}[]}
  /** Taught by the user on this device. */
  | {how: 'taught'; example: string; score: number}
  /** Decided from the amount or wording without the model (income, bank fees). */
  | {how: 'rule'; rule: string}

export interface Verdict {
  category: CategoryId
  /** 0 to 1. Below `REVIEW_BELOW` the row is offered to the user for a look. */
  confidence: number
  reason: Reason
  /** Finer grouping for some subscriptions, e.g. "video streaming". */
  kind?: string
}

export type Cadence = 'weekly' | 'every 2 weeks' | 'monthly' | 'every 3 months' | 'yearly'

export interface Recurring {
  merchant: string
  label: string
  category: CategoryId
  kind?: string
  cadence: Cadence
  /** Typical charge, as a positive number of cents. */
  typical: Cents
  /** What it costs over twelve months at the latest price. */
  yearly: Cents
  count: number
  firstDay: Day
  lastDay: Day
  nextDay: Day
  /** False when the next expected charge is well overdue at the end of the statement. */
  active: boolean
  /** Set when the latest price is higher than the price before it. */
  rise?: {from: Cents; to: Cents; day: Day}
  txnIds: number[]
}

export type AlertKind = 'duplicate' | 'price_rise' | 'fee' | 'unusual' | 'new_recurring' | 'overlap' | 'trial'

export interface Alert {
  kind: AlertKind
  title: string
  detail: string
  /** Money involved, positive cents. Used for ordering and for the total. */
  amount: Cents
  /** Yearly cost if this keeps happening, when that makes sense. */
  yearly?: Cents
  txnIds: number[]
}

export interface ImportResult {
  txns: Txn[]
  /** Lines that could not be read, with the reason, so nothing vanishes silently. */
  skipped: {line: number; why: string}[]
  columns: {date: string; description: string; amount: string}
  /** True when the file listed spending as positive numbers and the signs were turned round. */
  flipped: boolean
}
