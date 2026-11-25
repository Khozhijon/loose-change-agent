// Records the Loose Change agent demo footage in a headless browser (no screen is used) while the
// presenter reads the teleprompter text printed in this terminal. Writes timeline.json for mux.mjs.
// The model is the presenter's own Gemini key (env LC_GEMINI_KEY). --stub is a pipeline test with a
// scripted stand-in model and marks every frame "TEST RUN"; never publish a stub recording.
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0'
const pwPath = require.resolve('playwright', {paths: [process.cwd(), '/Users/khozhi/LocationKH']})
const {chromium} = require(pwPath)

const args = process.argv.slice(2)
const STUB = args.includes('--stub')
const FAST = args.includes('--no-wait') // test only: do not hold for the reading time
const outDir = path.resolve(args.find(a => !a.startsWith('--')) ?? 'out')
const A = 'http://127.0.0.1:8080/'
const B = 'http://127.0.0.1:8081/'
const MODEL = process.env.LC_MODEL || 'models/gemini-3.1-flash-lite'
const ROUTER = 'https://generativelanguage.googleapis.com/v1beta/openai'
const KEY = STUB ? 'stub-not-a-key' : process.env.LC_GEMINI_KEY
if (!KEY) { console.error('No key: run tools/record/run.sh, which asks for it.'); process.exit(2) }
const script = JSON.parse(fs.readFileSync(new URL('./script.json', import.meta.url), 'utf8'))
fs.mkdirSync(outDir, {recursive: true})
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- a scripted stand-in model, for pipeline tests only ----------
function stubRespond(messages, tools) {
  const names = tools.map(t => t.function.name)
  const lastUser = messages.map(m => m.role).lastIndexOf('user')
  const user = String(messages[lastUser].content)
  const toolMsgs = messages.slice(lastUser + 1).filter(m => m.role === 'tool')
  const call = (name, a) => ({tool_calls: [{index: 0, id: `call_${name}${toolMsgs.length}`, type: 'function', function: {name, arguments: JSON.stringify(a)}}]})
  const parse = m => { try { return JSON.parse(m.content) } catch { return null } }
  if (names.includes('website_review_statement_privately')) {
    return toolMsgs.length ? {content: 'Reviewed: ' + String(toolMsgs.at(-1).content).slice(0, 300)} : call('website_review_statement_privately', {})
  }
  const partner = names.find(n => /loose_change_agent/.test(n))
  if (partner) {
    if (!toolMsgs.length) return call('website_get_budget', {})
    if (toolMsgs.length === 1) return call(partner, {request: "Review the visitor's statement privately."})
    return {content: 'STUB: compared the budget with the summary.'}
  }
  const state = toolMsgs.map(parse).map(p => p?.result ?? p).find(r => r && r.loaded !== undefined)
  if (/merchants|place/i.test(user)) {
    if (!toolMsgs.length) return call('website_get_statement_state', {})
    if (toolMsgs.length === 1) return call('website_set_categories', {assignments: (state?.needsALook || []).map(x => ({merchant: x.merchant, category: 'shopping'}))})
    return {content: 'STUB: filed the merchants.'}
  }
  if (!toolMsgs.length) return call('website_load_sample_statement', {})
  if (toolMsgs.length === 1) return call('website_get_statement_state', {})
  return {content: 'STUB: loose change per year ' + state?.looseChangePerYearUsd}
}
async function installStub(context) {
  const sse = o => 'data: ' + JSON.stringify(o) + '\n\n'
  await context.route(/\/chat\/completions$/, route => {
    const body = route.request().postDataJSON()
    const r = stubRespond(body.messages, body.tools || [])
    const delta = r.content ? {content: r.content} : {tool_calls: r.tool_calls}
    route.fulfill({status: 200, contentType: 'text/event-stream', body: sse({model: 'alibaba/qwen3.8-flash', choices: [{delta}]}) + sse({model: 'alibaba/qwen3.8-flash', choices: [{delta: {}, finish_reason: r.content ? 'stop' : 'tool_calls'}]}) + 'data: [DONE]\n\n'})
  })
  await context.route(/\/models$/, route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({data: [{id: 'alibaba/qwen3.8-flash'}]})}))
}

// ---------- setup: save the key in the site's own settings (not recorded) ----------
async function configure(browser, statePath) {
  const context = await browser.newContext({viewport: {width: 1280, height: 720}})
  if (STUB) await installStub(context)
  for (const url of [A, B]) {
    const page = await context.newPage()
    await page.goto(url)
    await page.waitForSelector('#agent-app [data-ns-slot="settings"] summary, #agent-app [data-ns-slot="settings"] button', {timeout: 20000})
    const s = page.locator('[data-ns-slot="settings"]')
    await page.evaluate(() => { for (let e = document.querySelector('#ns-key'); e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true })
    await s.locator('#ns-key').fill(KEY)
    if (!STUB) {
      await page.evaluate(() => { for (const d of document.querySelectorAll('[data-ns-slot="settings"] details')) d.open = true })
      await s.locator('#ns-profile-name').fill('Google AI Studio')
      await s.locator('#ns-router').fill(ROUTER)
      await s.locator('#ns-model').fill(MODEL)
    }
    await Promise.all([page.waitForLoadState('load').catch(() => {}), s.locator('#ns-apply').click()])
    await sleep(2500)
    await page.close()
  }
  await context.storageState({path: statePath})
  await context.close()
}

// ---------- helpers for the recorded run ----------
const parts = []
let clock0 = 0
const now = () => (Date.now() - clock0) / 1000
function beginPart(p) {
  const rec = {id: p.id, label: p.label, start: now(), text: p.text, minSec: p.minSec}
  parts.push(rec)
  console.log(`\n\x1b[1;33m▶ PART ${p.id}/${script.parts.length}: ${p.label}  (read now)\x1b[0m\n\x1b[1m${p.text}\x1b[0m\n`)
  process.stdout.write('\x07')
  return rec
}
async function endPart(rec) {
  const left = rec.start + rec.minSec - now()
  if (left > 0 && !FAST) await sleep(left * 1000)
  rec.end = now()
}
async function answered(page, before, label) {
  const t0 = Date.now()
  let stable = 0
  while (Date.now() - t0 < 80000) {
    await sleep(500)
    const st = await page.evaluate(() => ({bots: document.querySelectorAll('#ns-msgs .ns-msg.bot').length, busy: !!document.querySelector('#ns-msgs .ns-turn-status'), text: [...document.querySelectorAll('#ns-msgs .ns-msg.bot')].at(-1)?.innerText || ''}))
    if (/LLM HTTP|^Error|could not|overloaded|503|429/i.test(st.text) && st.bots > before) throw new Error(`${label}: the model answered with an error: ${st.text.slice(0, 160)}`)
    if (st.bots > before && !st.busy && st.text.length > 25) { if (++stable >= 3) return st.text } else stable = 0
  }
  throw new Error(`${label}: no answer within 80 s`)
}
async function ask(page, text, label) {
  const before = await page.evaluate(() => document.querySelectorAll('#ns-msgs .ns-msg.bot').length)
  await page.locator('#ns-input').click()
  await page.keyboard.type(text, {delay: 18})
  await page.keyboard.press('Enter')
  return answered(page, before, label)
}
async function smooth(page, to, ms) {
  await page.evaluate(async ({to, ms}) => {
    const from = scrollY, t0 = performance.now()
    await new Promise(res => { const f = t => { const k = Math.min(1, (t - t0) / ms); scrollTo(0, from + (to - from) * (k * k * (3 - 2 * k))); k < 1 ? requestAnimationFrame(f) : res() }; requestAnimationFrame(f) })
  }, {to, ms})
}
const offsetOf = (page, sel) => page.evaluate(s => document.querySelector(s).getBoundingClientRect().top + scrollY - 70, sel)

// ---------- main ----------
const browser = await chromium.launch({headless: true})
const statePath = path.join(outDir, '.state.json')
try {
  console.log('Setting up the key (not recorded)…')
  await configure(browser, statePath)
  fs.chmodSync(statePath, 0o600)
  console.log('Ready. Get your microphone ready: the first part starts in 3 seconds.')
  await sleep(3000)

  const vidDir = path.join(outDir, 'video')
  fs.rmSync(vidDir, {recursive: true, force: true})
  const context = await browser.newContext({viewport: {width: 1280, height: 720}, storageState: statePath, recordVideo: {dir: vidDir, size: {width: 1280, height: 720}}})
  if (STUB) await installStub(context)
  await context.addInitScript(({stub}) => {
    document.addEventListener('DOMContentLoaded', () => {
      const d = document.createElement('div')
      d.textContent = location.host + (stub ? '   TEST RUN: scripted model' : '')
      d.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99999;font:600 13px ui-monospace,Menlo,monospace;background:#1d2721;color:#f4efe4;padding:4px 10px;border-radius:6px;opacity:.9;pointer-events:none'
      document.body.append(d)
    })
  }, {stub: STUB})
  const page = await context.newPage()
  clock0 = Date.now()
  const timeline = {clock0, stub: STUB, parts, popup: null}
  const P = id => script.parts.find(p => p.id === id)

  // 1
  let r = beginPart(P(1))
  await page.goto(A)
  await page.evaluate(() => { localStorage.removeItem('loose-change-agent:taught') })
  await page.reload()
  await endPart(r)
  // 2
  r = beginPart(P(2))
  await page.locator('#try-sample').click()
  await page.waitForSelector('#alerts .card')
  await sleep(900)
  await smooth(page, await offsetOf(page, '#regular'), Math.max(4000, (P(2).minSec - 4) * 700))
  await sleep(1500)
  await endPart(r)
  // 3
  r = beginPart(P(3))
  await smooth(page, await offsetOf(page, '#agent-app'), 1200)
  await ask(page, 'Load the sample statement and tell me what looks off.', 'question 1')
  await sleep(1200)
  await ask(page, 'Find the merchants you do not know and put them in the right categories.', 'question 2')
  await sleep(800)
  await smooth(page, await offsetOf(page, '#taught').catch(() => 0), 1500)
  await sleep(2500)
  await endPart(r)
  // 4
  r = beginPart(P(4))
  await page.goto(B)
  await page.waitForSelector('#ns-input')
  await smooth(page, await offsetOf(page, '#agent-app'), 900)
  const before = await page.evaluate(() => document.querySelectorAll('#ns-msgs .ns-msg.bot').length)
  await page.locator('#ns-input').click()
  await page.keyboard.type('Review my bank statement privately and tell me which budget lines I am over.', {delay: 18})
  await page.keyboard.press('Enter')
  const allow = page.locator('#ns-msgs .ns-consent button', {hasText: /^Allow$/})
  await allow.waitFor({timeout: 60000})
  await sleep(2500)
  await allow.click()
  const open = page.locator('#ns-msgs button', {hasText: /^Open Loose Change/})
  await open.waitFor({timeout: 80000})
  await sleep(1200)
  const popupP = context.waitForEvent('page', {timeout: 20000})
  const popStartMain = now()
  await open.click()
  const popup = await popupP
  const popVideoStart = now()
  await popup.setViewportSize({width: 1280, height: 720})
  await popup.waitForSelector('.review-window')
  await sleep(1500)
  await popup.locator('.review-window .row button.btn').first().click()
  await popup.waitForSelector('text=Send the summary')
  await sleep(3500)
  await popup.getByRole('button', {name: /Send the summary/}).click()
  const popEnd = now()
  timeline.popup = {videoStart: popVideoStart, start: popVideoStart, end: popEnd, popStartMain}
  await answered(page, before, 'Pocketbook answer')
  await sleep(3500)
  await endPart(r)
  // 5
  r = beginPart(P(5))
  await page.goto(A + 'loose_change_agent.network.json')
  await sleep(3500)
  await page.goto('https://github.com/Khozhijon/loose-change-agent')
  await sleep(3000)
  await endPart(r)
  timeline.total = now()

  const mainVideo = await page.video().path()
  const popVideo = await popup.video().path().catch(() => null)
  await context.close()
  timeline.files = {main: path.relative(outDir, mainVideo), popup: popVideo ? path.relative(outDir, popVideo) : null}
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 2))
  console.log(`\nFootage done: ${timeline.total.toFixed(1)} s.`)
} finally {
  await browser.close()
  fs.rmSync(statePath, {force: true})
}
