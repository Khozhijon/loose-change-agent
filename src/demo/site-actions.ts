// Pocketbook's one action: read the budget the page shows. Pocketbook has no statement of its own.
import {BUDGET} from './budget.ts'

export function registerActions(actions: {register(definition: unknown): void}): void {
  actions.register({
    name: 'get_budget',
    description: "Read the visitor's monthly budget lines, in dollars, and the partner sites this page can ask, with their links. Call it before answering about the budget, and before asking a partner.",
    effect: 'read',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    execute: () => ({
      currency: 'USD',
      monthlyBudget: BUDGET,
      totalMonthlyUsd: BUDGET.reduce((a, b) => a + b.usd, 0),
      partners: [{name: 'Loose Change', link: 'https://khozhijon.github.io/loose-change-agent/', what: 'Reviews a bank statement privately for subscriptions, price rises, double charges and fees.'}],
    }),
  })
}
