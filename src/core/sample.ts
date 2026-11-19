import {toCsv} from './csv.ts'
import {fromDay, toDay} from './dates.ts'
import type {Day} from './types.ts'

/**
 * Builds the sample statement: six months of an invented student's checking account, written
 * the way a bank writes it. Nothing in it is real. The same statement comes out every time,
 * so the tests can count on what is hidden in it:
 *
 *   - Netflix, the internet bill and a newspaper put their prices up
 *   - a design-software trial for $1 turned into $22.99 a month
 *   - three video streaming subscriptions run side by side
 *   - a study-help subscription was billed twice in one month, and a restaurant charged twice
 *   - monthly account fees, ATM fees, foreign transaction fees, wire fees and one overdraft
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SAMPLE_START = toDay(2026, 5, 1)
export const SAMPLE_END = toDay(2026, 10, 31)

export function sampleStatement(): string {
  const rand = seeded(20261116)
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100)
  const rows: {day: Day; text: string; cents: number}[] = []
  const out = (day: Day, text: string, cents: number) => rows.push({day, text, cents: -Math.abs(cents)})
  const into = (day: Day, text: string, cents: number) => rows.push({day, text, cents: Math.abs(cents)})
  const ref = () => String(Math.floor(rand() * 9e9) + 1e9)

  for (let month = 5; month <= 10; month++) {
    const d = (date: number) => toDay(2026, month, date)
    // Money in: a campus job every other Friday is added below; family support by wire.
    into(d(2), `INTL WIRE TRANSFER CREDIT REF ${ref()}`, 160000)
    out(d(2), 'INCOMING WIRE TRANSFER FEE', 1500)
    // Home.
    out(d(1), 'WEB PMT CEDAR COURT APARTMENTS LLC', 115000)
    out(d(9), `EVERSOURCE WEB PAY 800-592-2000`, between(46, 92))
    out(d(14), 'COMCAST CABLE COMM 800-COMCAST MA', month >= 9 ? 5500 : 4500)
    out(d(21), 'MINT MOBILE 800-683-7392 CA', 1500)
    out(d(3), 'MBTA CHARLIE CARD 617-222-3200 MA', 9000)
    out(d(5), 'ONLINE TRANSFER TO SAV ...4821', 10000)
    out(d(28), 'MONTHLY SERVICE FEE', 1200)
    // Subscriptions.
    out(d(7), 'NETFLIX.COM 866-579-7172 CA', month >= 8 ? 1799 : 1549)
    out(d(11), 'SPOTIFY USA 877-778-1161 NY', 599)
    out(d(16), 'HULU 877-8244858 CA', 999)
    out(d(19), 'DISNEY PLUS 888-905-7888 CA', 1399)
    out(d(23), 'APPLE.COM/BILL 866-712-7753 CA', 299)
    out(d(12), 'PLANET FITNESS CLUB FEES 844-880-7180', 2499)
    out(d(25), `AMAZON PRIME*${ref().slice(0, 9)} AMZN.COM/BILL WA`, 749)
    out(d(18), 'CHEGG ORDER CHEGG.COM CA', 1595)
    if (month === 8) out(d(19), 'CHEGG ORDER CHEGG.COM CA', 1595)
    if (month === 7) out(d(6), 'ADOBE *CREATIVE CLOUD 408-536-6000 CA', 100)
    if (month >= 8) out(d(6), 'ADOBE *CREATIVE CLOUD 408-536-6000 CA', 2299)
    if (month >= 9) out(d(4), 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', 2000)
    out(d(26), 'NYTIMES*NYTIMES DIGITAL 800-698-4637 NY', month >= 10 ? 1700 : 400)
  }

  // A campus job, paid every second Friday.
  for (let day = toDay(2026, 5, 8); day <= SAMPLE_END; day += 14) into(day, 'UNIVERSITY DINING SVCS PAYROLL DIR DEP', between(398, 446))

  const coffee = ['STARBUCKS STORE 07342 BOSTON MA', 'DUNKIN #338120 Q35 CAMBRIDGE MA', 'SQ *THINKING CUP BOSTON MA', 'TATTE BAKERY & CAFE BOSTON MA', 'CAMPUS CENTER CAFE KIOSK 02 BOSTON MA']
  const groceries = ["TRADER JOE'S #512 BOSTON MA", 'DEBIT CARD PURCHASE - STAR MARKET 3581 BOSTON MA', 'H MART BURLINGTON MA', 'MING SUPERMARKET BOSTON MA']
  const eating = ['CHIPOTLE 1873 CAMBRIDGE MA', 'TST* SWEETGREEN BACK BAY BOSTON MA', 'SQ *GOLDEN DRAGON NOODLE HOUSE BOSTON MA', 'ANNAS TAQUERIA BROOKLINE MA', 'OTTO PIZZA HARVARD SQ CAMBRIDGE MA', 'DOORDASH*THAI BASIL 855-973-1040 CA', 'SQ *SEOUL KITCHEN ALLSTON MA']
  const rides = ['UBER *TRIP HELP.UBER.COM CA', 'LYFT *RIDE LYFT.COM CA', 'BLUEBIKES 855-948-2929 MA']
  const shops = [`AMZN MKTP US*${ref().slice(0, 9)} AMZN.COM/BILL WA`, 'TARGET 00012345 BOSTON MA', 'UNIQLO NEWBURY ST BOSTON MA', 'CVS/PHARMACY #00218 BOSTON MA', 'SQ *SECOND LIFE THRIFT STORE SOMERVILLE MA']

  for (let day = SAMPLE_START; day <= SAMPLE_END; day++) {
    const {dow} = fromDay(day)
    const weekend = dow === 0 || dow === 6
    if (rand() < (weekend ? 0.45 : 0.62)) out(day, pick(coffee), between(3.25, 7.4))
    if (dow === 0 || (dow === 3 && rand() < 0.35)) out(day, pick(groceries), between(22, 78))
    if (rand() < (weekend ? 0.5 : 0.24)) out(day, pick(eating), between(9.5, 34))
    if (rand() < (weekend ? 0.3 : 0.1)) out(day, pick(rides), between(4.5, 23))
    if (rand() < 0.1) out(day, pick(shops), between(7, 64))
    if (rand() < 0.035) out(day, `VENMO PAYMENT ${ref()}`, between(8, 45))
  }

  // One-off events.
  const once = (m: number, date: number, text: string, cents: number) => out(toDay(2026, m, date), text, cents)
  once(6, 12, 'PLANET FITNESS ANNUAL FEE 844-880-7180', 4900)
  once(5, 22, 'AMC 4421 BOSTON COMMON MA', 1699)
  once(6, 6, 'TICKETMASTER 800-653-8000 CA', 8450)
  once(7, 3, 'JETBLUE 2792187345221 SALT LAKE CTY UT', 28740)
  once(7, 9, 'AIRBNB * HMXQ4K2ZBA AIRBNB.COM CA', 21400)
  once(7, 11, 'PEGASUS AIRLINES 6241839201 ISTANBUL', 13260)
  once(7, 11, 'FOREIGN TRANSACTION FEE 07/11', 398)
  once(7, 18, 'GRAND BAZAAR CARPET & GIFT ISTANBUL', 6120)
  once(7, 18, 'FOREIGN TRANSACTION FEE 07/18', 184)
  once(7, 20, 'KARAKOY GULLUOGLU ISTANBUL', 1840)
  once(7, 20, 'FOREIGN TRANSACTION FEE 07/20', 55)
  once(8, 22, 'STEAMGAMES.COM 4259522985 WA', 2999)
  once(9, 2, 'CAMPUS BOOKSTORE TEXTBOOKS 0019', 18640)
  once(9, 3, 'UNIVERSITY LIBRARY PRINTING', 1000)
  once(9, 12, 'TST* LA CASA DE PEDRO WATERTOWN MA', 3840)
  once(9, 12, 'TST* LA CASA DE PEDRO WATERTOWN MA', 3840)
  once(9, 27, 'BAYVIEW FAMILY DENTAL QUINCY MA', 8500)
  once(10, 3, 'MUSEUM OF FINE ARTS ADMISSION BOSTON MA', 2700)
  once(10, 9, 'SQ *FADE FACTORY BARBERSHOP BOSTON MA', 3500)
  once(10, 17, 'REMITLY* R48213 206-535-6152 WA', 20000)
  once(10, 24, 'OVERDRAFT FEE', 3400)
  for (const [m, date] of [[5, 16], [6, 27], [8, 8], [9, 19], [10, 23]] as const) {
    once(m, date, `NON-NETWORK ATM WITHDRAWAL 7-ELEVEN ${ref().slice(0, 5)}`, 6000)
    once(m, date, 'NON-NETWORK ATM FEE', 300)
  }

  rows.sort((a, b) => a.day - b.day)
  const date = (day: Day) => {
    const {y, m, d} = fromDay(day)
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`
  }
  return toCsv([['Date', 'Description', 'Amount'], ...rows.map(r => [date(r.day), r.text, (r.cents / 100).toFixed(2)])])
}
