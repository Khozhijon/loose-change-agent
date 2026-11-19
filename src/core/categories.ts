import type {CategoryId} from './types.ts'

export interface Category {
  id: CategoryId
  label: string
  /** Counted as spending in totals. Transfers and income are not. */
  spending: boolean
  /** Ink colour for charts and chips. Chosen to stay apart for common colour-vision differences. */
  ink: string
}

export const CATEGORIES: Category[] = [
  {id: 'housing', label: 'Housing', spending: true, ink: '#4b5d8f'},
  {id: 'bills', label: 'Bills & phone', spending: true, ink: '#2f7f86'},
  {id: 'groceries', label: 'Groceries', spending: true, ink: '#4f8a3c'},
  {id: 'eating_out', label: 'Eating out', spending: true, ink: '#c2562d'},
  {id: 'coffee', label: 'Coffee & snacks', spending: true, ink: '#8a5a2b'},
  {id: 'transport', label: 'Getting around', spending: true, ink: '#6a6fb5'},
  {id: 'travel', label: 'Travel', spending: true, ink: '#2c8fc0'},
  {id: 'subscriptions', label: 'Subscriptions', spending: true, ink: '#b0407c'},
  {id: 'shopping', label: 'Shopping', spending: true, ink: '#c79a1e'},
  {id: 'health', label: 'Health & care', spending: true, ink: '#3a9d7a'},
  {id: 'education', label: 'Education', spending: true, ink: '#7b4fa3'},
  {id: 'fun', label: 'Fun', spending: true, ink: '#d0703c'},
  {id: 'fees', label: 'Bank fees', spending: true, ink: '#b3312b'},
  {id: 'cash', label: 'Cash', spending: true, ink: '#6b7366'},
  {id: 'other', label: 'Other', spending: true, ink: '#8d8778'},
  {id: 'transfers', label: 'Transfers', spending: false, ink: '#9aa1a8'},
  {id: 'income', label: 'Money in', spending: false, ink: '#2f6b3f'},
]

const BY_ID = new Map(CATEGORIES.map(c => [c.id, c]))

export function category(id: CategoryId): Category {
  return BY_ID.get(id)!
}

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map(c => c.id)
