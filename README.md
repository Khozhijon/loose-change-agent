# Loose Change agent

An **open agentic website** for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).
Drop in a bank statement and the page finds forgotten subscriptions, price rises, double charges and bank fees.
Then an assistant, running in your browser on **your own AI key**, answers questions about it, files the merchants the
rules do not know, and can save a report. Other agent websites can call it too.

**Live site:** https://khozhijon.github.io/loose-change-agent/ (press "Try the sample statement", then ask the assistant)
**Network address (for other agent sites):** `https://khozhijon.github.io/loose-change-agent/loose_change_agent`
**Demo caller (another agentic site that uses this one):** https://khozhijon.github.io/loose-change-agent/pocketbook/

Built with help from [Claude Code](https://claude.com/claude-code). See [Credits and licences](#credits-and-licences).

## Why an agent, and why this one

Statements are private. The usual answer is "upload it to a service". An open agentic website turns that around:
the agent network is published as plain data, the runtime and the model call both run in the visitor's browser,
and the visitor chooses (and pays for) the model. Nothing about a bank statement has to reach this site's server,
because there is no server.

The part that is new for the open agentic web is the **call from another site**. A budgeting site, a bank's help
page or a student-finance site should not have to build statement analysis, and its visitors should not have to hand
their statement to a stranger's page. So this site exposes two things to other agent sites:

| Shared tool | Kind | What happens |
| --- | --- | --- |
| `categorise_merchants` | read | The caller's agent sends up to 40 statement lines (bank wording, optional amount). It gets back a cleaned merchant name, a category and a confidence for each, and `needsReview: true` for merchants the rules do not know, so the caller's own model can decide. It runs in a hidden frame on this origin, keeps nothing, and calls nobody. |
| `review_statement_privately` | irreversible (confirmed in a window) | A window opens **on this site**. The visitor picks their own statement there, so the file never passes through the caller's page or its model. The window shows the exact summary that would be sent (period, totals, regular charges, alert titles, no lines, no bank wording). Only if the visitor presses Send does the caller's agent get that summary. |

## What conforms to the spec

Checked against [MVP Profile 0.3](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)
and the Submission Requirements:

| Requirement | Where |
| --- | --- |
| Public data-only agent network (Neuro SAN, resolved JSON) | [`site/loose_change_agent.network.json`](site/loose_change_agent.network.json), source [`site/loose_change_agent.hocon`](site/loose_change_agent.hocon) |
| Manifest with network, front agent, router, peer policy | [`site/agent-manifest.json`](site/agent-manifest.json), [`site/links.json`](site/links.json), `.well-known/nsdeploy*.json` |
| Browser runtime | [`site/runtime/`](site/runtime/) (nsDeploy-derived runtime from the agentic-web repo, unchanged) |
| Interface to use the network | the chat under the page; the page's own buttons use the same code |
| Interface for the visitor's LLM and key (BYOK) | the runtime's "AI model settings": Google AI Studio, OpenAI, Anthropic, OpenRouter, Otari, Groq or a local model. The site pays for no model calls. |
| Agent network interacts with the website | five page tools (below) |
| Can be called by other agent sites | `bridge/` and the two shared tools above; `check_partner.mjs` passes; a working caller is in [`demo/pocketbook/`](demo/pocketbook/) |
| Consent, private data, fail closed | the runtime's consent card, `confirmsInWindow` window, `irreversible` confirmation dialog; `peer_policy` is `closed` |
| Static hosting with CORS | GitHub Pages sends `Access-Control-Allow-Origin: *` on the public files |
| Restrictive CSP | meta CSP in [`site/index.html`](site/index.html): no third-party scripts; connections only to this origin and the AI provider the visitor picks |

### The page's tools (what the assistant can do here)

| Tool | Effect | Notes |
| --- | --- | --- |
| `get_statement_state` | read | Period, totals, categories, regular charges with price rises, alerts with their lines, merchants that need a look. **Cleaned merchant names, dates and amounts only. Never the bank's own wording**, which can carry card or account numbers. |
| `query_spending` | read | Sums by category, merchant and date range, so the model never does arithmetic. |
| `load_sample_statement` | write | Loads the invented sample statement. |
| `set_categories` | write | Places merchants the rules do not know. The visitor sees them on the page and can undo each one. |
| `save_report` | irreversible | Saves a Markdown report. The runtime, not the model, asks for confirmation, and the dialog shows what the file contains. The site refuses a stale `expectedVersion`. |

The agent is told what it cannot do (read PDFs, connect to a bank, cancel anything, give financial advice) and the
sample queries include one it must decline ("Cancel my Netflix subscription for me.").

## Privacy, stated carefully

- The statement is read **in the page**. The page, the actions and the bridge make no network requests of their own.
- The assistant needs a language model. That model is the visitor's choice, and the visitor's key goes only to it.
  What that provider receives is the chat and whatever the assistant's tools returned: cleaned merchant names, dates
  and amounts, never raw bank lines. The "Agents working for you" panel and the Developer view show every tool call.
- Everything the page computes (categories, regular charges, alerts) uses no model at all.
- This site has no server, no analytics and no third-party scripts. It cannot see keys, statements or chats.

Honest limits: a hosted language model still sees the cleaned data it is asked about; the network file and its
instructions are public by design; CSV only; one statement at a time; a static site cannot remember a statement
between visits.

## How another agent site calls it

1. Put the network address in the calling agent's `tools` and name it in `link_labels`:
   `"https://khozhijon.github.io/loose-change-agent/loose_change_agent": "Loose Change"`.
2. Add `https://khozhijon.github.io` to the caller's `allowed_peers`.
3. Tell the agent when to ask it, as [`demo/pocketbook/pocketbook_coach.hocon`](demo/pocketbook/pocketbook_coach.hocon) does.

The caller's visitor sees a consent card naming this site before anything is contacted. The network then runs in
the caller's browser on the caller's visitor's model; the visitor's key never reaches this site.
Check any site against it with:

```sh
node tools/agentify-skill/scripts/check_partner.mjs https://khozhijon.github.io/loose-change-agent/loose_change_agent --origin https://your-site.example
```

## Run it

Needs Node 22.18+ (for running TypeScript directly) and, to try the assistant, an AI key from any supported provider.
Google AI Studio has a free tier.

```sh
npm install
npm run build        # bundles src/ into site/
npm run network      # builds and checks the network JSON and the bridge
npm test             # type-check and 14 tests
npm run serve        # http://127.0.0.1:8080/
```

To try the cross-origin call locally (two different origins, as on the open web):

```sh
npm run demo         # prepares _local-demo/pocketbook with a local partner address
node tools/agentify-skill/scripts/serve_site.mjs _local-demo/pocketbook --port 8081 --open-as localhost
```

Open `http://localhost:8081/` (Pocketbook) while `npm run serve` runs on `127.0.0.1:8080`, add your key, and ask
"Review my bank statement privately and tell me which budget lines I am over." On `localhost` and `127.0.0.1` the
runtime also keeps the key in a cookie for local ports; delete the setup and close the tab afterwards.

## Layout

```
site/                 the published site (index.html, style.css, manifest, network, runtime, bridge)
src/core/             Loose Change's rules and finders (merchant cleaning, categories, regular charges, alerts)
src/page/             the page: Ledger (state and rules), UI, download
src/actions/          site actions: the tools the assistant gets on this page
src/bridge/           what other sites get: categorise_merchants and the private review window
src/assistant/        boots the runtime in the page and writes its confirmation dialog
src/demo/, demo/      Pocketbook, a second agentic site that calls this one
tools/agentify-skill/ build and check scripts from the agentic-web repo (Apache 2.0)
tests/                Node tests
```

## What was new for the challenge

The classifier and statement finders in `src/core/` come from my earlier
[Loose Change](https://github.com/Khozhijon/loose-change) project (MIT, written on 14 to 16 Nov 2026 for another
contest), used here in its rules-only form (no 23 MB embedding model). Everything agentic is new and written for
this challenge: the page's state object and UI for the agent edition, the five page tools, the network and its
instructions, the two bridge tools and the private review window, the confirmation dialog, the manifest, the tests,
the CSP, and the Pocketbook demo caller. The unknown-merchant step also changes: instead of a bundled model, the
visitor's own assistant places merchants, and the visitor can see and undo each choice.

## Credits and licences

- This project: MIT, see [`LICENSE`](LICENSE).
- `site/runtime/`, `tools/agentify-skill/`: from [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web)
  and nsDeploy, Apache License 2.0 (see `LICENSE-agentic-web-APACHE-2.0.txt` and `site/runtime/LICENSE.txt`), used
  unchanged. Neuro SAN is the agent-network format.
- `src/core/`: from Loose Change, MIT, by the same author.
- Built with help from Claude Code.
- Loose Change does not give financial advice. It adds up what a statement already says.
