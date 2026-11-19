// The actions this site shares with other agent sites, through its action bridge.
// bridge/agent-manifest.json loads this module in the bridge frame, which has no page of ours.
// Both actions run on this site's origin, in the visitor's own browser. Nothing is stored.
import {CATEGORY_LIST, categorise, MAX_ITEMS, MAX_LENGTH} from './categorise.ts'
import {openReview} from './review-window.ts'

const CALLERS = ['*']

function categoriseAction() {
  return {
    name: 'categorise_merchants',
    description: `Put bank statement lines into spending categories with Loose Change's rules and known merchants. Give up to ${MAX_ITEMS} descriptions exactly as the bank wrote them (optionally the amount in dollars, negative for money out). Returns the cleaned merchant name, category and confidence per line; needsReview true means it does not know that merchant, so decide from the name or ask the visitor. Runs in this browser and keeps nothing. Changes nothing.`,
    effect: 'read',
    availability: 'bridge',
    callerOrigins: CALLERS,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ITEMS,
          description: 'Statement lines to place.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description'],
            properties: {
              description: {type: 'string', maxLength: MAX_LENGTH, description: 'The line as the bank wrote it, such as "POS DEBIT SQ *BLUE BOTTLE COF OAKLAND CA".'},
              usd: {type: 'number', description: 'Amount in dollars, negative for money out. Optional.'},
            },
          },
        },
      },
    },
    execute: (args: {items: {description: string; usd?: number}[]}) => ({categories: CATEGORY_LIST, results: categorise(args.items)}),
  }
}

function reviewAction() {
  return {
    name: 'review_statement_privately',
    description: "Review the visitor's bank statement for loose change (forgotten subscriptions, price rises, double charges, bank fees). A window opens on the Loose Change site where the visitor picks their own statement file, so never ask for the statement, its lines or any bank details in the chat. It returns only after the visitor presses Send or Keep it private. With ok true it returns a short summary: period, totals, top categories, regular charges and alert titles, with no lines and no bank wording. With ok false the visitor kept it private: say so and do not retry.",
    effect: 'irreversible',
    availability: 'bridge',
    callerOrigins: CALLERS,
    // The window shows exactly what will be sent and asks, so the generic dialog is not needed.
    confirmsInWindow: true,
    inputSchema: {type: 'object', additionalProperties: false, properties: {}},
    execute: (_args: unknown, context?: {callerOrigin?: string}) => new Promise(resolve => openReview(context?.callerOrigin, resolve)),
  }
}

export function registerActions(actions: {register(definition: unknown): void}): void {
  actions.register(categoriseAction())
  actions.register(reviewAction())
}
