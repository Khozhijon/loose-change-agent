import type {Cents} from './types.ts'

/** 123456 -> "$1,234.56". Whole dollars drop the cents when `round` is set. */
export function money(cents: Cents, round = false): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = round ? Math.round(abs / 100) : Math.floor(abs / 100)
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const text = round ? `$${withCommas}` : `$${withCommas}.${String(abs % 100).padStart(2, '0')}`
  return negative ? `-${text}` : text
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
