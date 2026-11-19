// Registers this website's operations with the agent runtime (agent-manifest.json: actions.module).
// Each action wraps a method of the page's own Ledger, so the assistant and the page's buttons
// share one set of rules. Only the names in actions.agentTools become tools, as website_<name>.
import {Ledger} from '../page/ledger.ts'
import {downloadText} from '../page/download.ts'
import {CATEGORY_IDS} from '../core/categories.ts'

const page = () => Ledger.page

function readStateAction() {
  return {
    name: 'get_statement_state',
    description: "Read the visitor's statement as Loose Change sees it: period, totals, spending by category, regular charges (subscriptions and bills) with price rises, alerts with the lines behind them, merchants that need a look, and a version. Cleaned merchant names and amounts only, never the bank's own wording. Call it before answering about the statement, and again in each turn that needs it: the visitor can load another statement or change a category on the page. If loaded is false, tell the visitor to drop in a CSV from their bank or try the sample.",
    effect: 'read',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    execute: () => page().snapshot(),
  }
}

function loadSampleAction() {
  return {
    name: 'load_sample_statement',
    description: 'Load the invented sample statement (six months of a made-up student account) into the page. Call it only when the visitor asks to try the sample or has no statement. It replaces any statement already loaded, so ask first if one is. Returns the number of lines read. Read the state next.',
    effect: 'write',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    execute: () => page().loadSample(),
  }
}

function setCategoriesAction() {
  return {
    name: 'set_categories',
    description: 'Put merchants in spending categories, for merchants listed in needsALook or that the visitor says are filed wrongly. Give all of them in one call (up to 30). Call it only when the visitor asks or agrees. Use each merchant name exactly as get_statement_state shows it, and a category id from categoriesYouCanUse. It changes every line of those merchants, and the visitor can undo each on the page. Returns one result per merchant, with ok false and a reason for any that is not in the statement.',
    effect: 'write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['assignments'],
      properties: {
        assignments: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['merchant', 'category'],
            properties: {
              merchant: {type: 'string', minLength: 1, maxLength: 80, description: 'Merchant name from get_statement_state.'},
              category: {type: 'string', enum: CATEGORY_IDS, description: 'The category id.'},
            },
          },
        },
      },
    },
    execute: (args: {assignments: {merchant: string; category: string}[]}) => ({results: args.assignments.map(a => page().setCategory(a.merchant, a.category))}),
  }
}

function querySpendingAction() {
  return {
    name: 'query_spending',
    description: 'Add up lines in the statement, so you never do the sums yourself. All filters are optional and combine: a category id, part of a merchant name, and a date range as YYYY-MM-DD (inclusive). With no filter it adds up everything spent. Returns the total in dollars, the line count, the average, the biggest line, the top merchants and up to 8 sample lines. Changes nothing.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        category: {type: 'string', enum: CATEGORY_IDS, description: 'Only this category. "income" adds up money in.'},
        merchant: {type: 'string', maxLength: 80, description: 'Part of a merchant name, such as "uber".'},
        from: {type: 'string', format: 'date', description: 'First day, YYYY-MM-DD.'},
        to: {type: 'string', format: 'date', description: 'Last day, YYYY-MM-DD.'},
      },
    },
    execute: (args: {category?: string; merchant?: string; from?: string; to?: string}) => page().query(args),
  }
}

function saveReportAction() {
  return {
    name: 'save_report',
    description: 'Save a short Markdown report (alerts, regular charges, spending by category) to the visitor\'s Downloads folder as loose-change-report.md. Call it only when the visitor asks for a report. In the turn you call it, first call website_get_statement_state and pass its version as expectedVersion: the site refuses a stale version. The browser asks the visitor to confirm. Returns ok true and the file name, or ok false with a reason.',
    effect: 'irreversible',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion'],
      properties: {expectedVersion: {type: 'integer', minimum: 0, description: 'The version from get_statement_state in this turn.'}},
    },
    execute: (args: {expectedVersion: number}) => {
      const check = page().checkReport(args.expectedVersion)
      if (!check.ok) return check
      const text = page().reportMarkdown()
      downloadText('loose-change-report.md', text)
      return {ok: true, savedAs: 'loose-change-report.md', characters: text.length}
    },
  }
}

export function registerActions(actions: {register(definition: unknown): void}): void {
  actions.register(readStateAction())
  actions.register(loadSampleAction())
  actions.register(setCategoriesAction())
  actions.register(querySpendingAction())
  actions.register(saveReportAction())
}
