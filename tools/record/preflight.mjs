// A judge's-eye check of the live site: loads the pages, tries the sample, collects console errors and failed requests.
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0'
const {chromium} = require(require.resolve('playwright', {paths: [process.cwd(), '/Users/khozhi/LocationKH']}))
const BASE = process.argv[2] || 'https://khozhijon.github.io/loose-change-agent/'
const browser = await chromium.launch({headless: true})
const out = {base: BASE, pages: {}}
try {
  for (const [name, url] of [['site', BASE], ['pocketbook', BASE + 'pocketbook/']]) {
    const context = await browser.newContext({viewport: {width: 1280, height: 720}})
    const page = await context.newPage()
    const errors = [], failed = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 160)))
    page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()) })
    await page.goto(url, {waitUntil: 'load'})
    await page.waitForTimeout(2500)
    const info = await page.evaluate(() => ({title: document.title, engine: !!window.__nsweb?.engine, status: document.getElementById('assistant-status')?.textContent, h1: document.querySelector('h1')?.textContent, actions: window.__nsweb ? window.__nsweb.engine.actions.catalog({base: window.__nsweb.engine.top.base, network: window.__nsweb.engine.top.network.name}).map(a => a.name) : null}))
    if (name === 'site') {
      await page.click('#try-sample')
      await page.waitForSelector('#alerts .card')
      info.headline = (await page.textContent('#headline')).replace(/\s+/g, ' ').trim().slice(0, 90)
      info.alerts = await page.locator('#alerts .card').count()
      info.regular = await page.locator('#regular tbody tr').count()
      info.review = await page.locator('#review li').count()
      info.overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    }
    const manifest = await (await context.request.get(new URL('agent-manifest.json', url).href)).json()
    info.networkUrl = new URL(manifest.networks[0].hocon, url).href
    const net = await context.request.get(info.networkUrl)
    info.networkOk = net.ok()
    out.pages[name] = {...info, consoleErrors: errors, failedRequests: failed}
    await context.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify(out, null, 2))
