/**
 * Turns a bank's description line into a merchant name.
 *
 *   "POS DEBIT 0412 SQ *BLUE BOTTLE COF OAKLAND CA 94612 #2231"  ->  "blue bottle cof"
 *
 * The cleaned name is what transactions are grouped by and what the model reads, so the
 * same shop must come out the same on every line whatever reference numbers follow it.
 */

/** Words banks and card networks put in front of the merchant. */
const LEADERS = [
  'pos debit', 'pos purchase', 'pos withdrawal', 'pos', 'debit card purchase', 'debit card', 'card purchase',
  'purchase authorized on', 'recurring payment authorized on', 'recurring payment', 'purchase', 'checkcard',
  'check card', 'visa purchase', 'visa', 'mastercard', 'ach debit', 'ach credit', 'ach withdrawal', 'ach',
  'electronic withdrawal', 'web pmt', 'online payment', 'online pmt', 'bill payment', 'billpay', 'pmt',
  'withdrawal', 'debit', 'credit', 'point of sale', 'contactless', 'card', 'intl', 'international',
]

/** Payment processors that prefix the real shop: "SQ *", "TST* ", "PAYPAL *", "SP ". */
const PROCESSORS = /^(sq|tst|sp|pp|paypal|py|in|ic|dd|fs|sqc|gum|pos|ctlp|nyx|zzz|bt|cke|wpy|ezi|sumup|izettle|toast|clover)\s*\*\s*/

const US_STATES = new Set(
  'al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc'.split(' '),
)

/** Tail words that say nothing about who was paid. */
const TAIL_NOISE = new Set(['usa', 'us', 'inc', 'llc', 'ltd', 'co', 'corp', 'com', 'www', 'http', 'https', 'card', 'ref', 'id', 'trace', 'seq', 'auth', 'pending'])

export function cleanMerchant(raw: string): string {
  let s = ` ${raw.toLowerCase()} `
  // Dates and times some banks print inside the line.
  s = s.replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, ' ')
  s = s.replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/g, ' ')
  // Card tails and reference numbers: "card 1234", "xxxx1234", "#2231", "ref 99812".
  s = s.replace(/\b(card|ending in|ref|trace|seq|auth|id|conf|confirmation)\s*(no\.?|number|#)?\s*[:#]?\s*[x*\d][x*\d-]{2,}\b/g, ' ')
  s = s.replace(/[x*]{2,}\d{2,}/g, ' ')
  s = s.replace(/#\s*\d+/g, ' ')
  s = s.trim()

  let changed = true
  while (changed) {
    changed = false
    for (const lead of LEADERS) {
      if (s.startsWith(`${lead} `)) {
        s = s.slice(lead.length + 1).trim()
        changed = true
      }
    }
    const before = s
    // A terminal or batch number between the bank's prefix and the merchant: "pos debit 0412 sq *...".
    s = s.replace(/^\d+\s+/, '')
    s = s.replace(PROCESSORS, '')
    if (s !== before) changed = true
  }

  // "amzn mktp us*2k4lx91z0" and "apple.com/bill": keep the part before the code.
  s = s.replace(/\*\s*[a-z0-9]*\d[a-z0-9]*\b/g, ' ')
  s = s.replace(/\*/g, ' ')
  s = s.replace(/\.com\/bill\b/g, ' bill ')
  s = s.replace(/\b(https?:\/\/|www\.)/g, ' ')
  s = s.replace(/\.(com|net|org|io|co|app)\b/g, ' ')
  s = s.replace(/[^a-z0-9&'+\- ]/g, ' ')
  // Banks drop apostrophes and leave the letter behind: "trader joe s" is "trader joe's".
  s = s.replace(/([a-z]{2,}) s(?= |$)/g, "$1's")

  let words = s.split(/\s+/).filter(Boolean)
  const isNumber = (w: string) => /^\d{3,}$/.test(w) || /^\d+-\d+(-\d+)*$/.test(w) || /^[a-z]?\d{5,}[a-z]?$/.test(w) || /^\d+$/.test(w) || /^[a-z]\d{2,}$/.test(w)
  // The tail is usually "... [store number] [city] [state]". Take the state, then either the
  // store number or one city word, never a word that sits before a store number: in
  // "true value hardware 3391 oh" the word before the state is what the shop sells.
  while (words.length > 1) {
    const last = words[words.length - 1]!
    if (TAIL_NOISE.has(last) || isNumber(last)) {
      words.pop()
    } else if (US_STATES.has(last) && words.length > 2) {
      words.pop()
      const before = words[words.length - 1]!
      if (isNumber(before)) while (words.length > 1 && isNumber(words[words.length - 1]!)) words.pop()
      else if (words.length > 2) words.pop()
      break
    } else {
      break
    }
  }
  // Phone numbers, zip codes and long digit runs left in the middle.
  words = words.filter(w => !/^\d{3,}$/.test(w) && !/^\d+-\d+(-\d+)*$/.test(w) && !/^[a-z]?\d{5,}[a-z]?$/.test(w))
  words = words.filter(w => w !== '-' && w !== '&' && w !== "'")
  const out = words.slice(0, 5).join(' ').trim()
  return out || raw.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)
}

const KEEP_UPPER = new Set(['atm', 'usa', 'ups', 'cvs', 'ikea', 'h&m', 'bp', 'kfc', 'amc', 'aaa', 'att', 'at&t', 'irs', 'dmv', 'nyc', 'mta', 'bart', 'ach', 'hbo', 'ibm'])

/** "blue bottle cof" -> "Blue Bottle Cof". Only for showing. */
export function labelFor(merchant: string): string {
  return merchant
    .split(' ')
    .map(w => (KEEP_UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}
