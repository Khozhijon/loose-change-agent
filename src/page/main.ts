// The page itself: drop in a statement, see the loose change. It works with no assistant at all.
// The assistant (site.js) reads and changes the same Ledger, so what you see is what it sees.
import {category, CATEGORIES} from '../core/categories.ts'
import {formatDay} from '../core/dates.ts'
import {money, plural} from '../core/money.ts'
import {looseChange} from '../core/alerts.ts'
import {Ledger} from './ledger.ts'
import {downloadText} from './download.ts'

export const App = {page: Ledger.page}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

function esc(text: string): string {
  return text.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!)
}

function toast(text: string): void {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  setTimeout(() => (t.hidden = true), 3500)
}

function open(text: string, name: string): void {
  const r = App.page.loadCsv(text, name)
  const error = $('start-error')
  error.hidden = r.ok
  if (!r.ok) error.textContent = r.reason
}

function paint(): void {
  const p = App.page
  $('start').hidden = p.loaded
  $('app').hidden = !p.loaded
  if (!p.loaded) return
  const s = p.summary
  $('file-line').textContent = `${p.fileName}: ${plural(p.txns.length, 'line')}, ${formatDay(s.startDay)} to ${formatDay(s.endDay)}${p.imported!.skipped.length ? `, ${p.imported!.skipped.length} unreadable` : ''}`
  const loose = looseChange(p.alerts)
  $('headline').innerHTML = `
    <p class="big"><span>${money(loose, true)}</span> a year of loose change</p>
    <p class="soft">Found in ${plural(p.alerts.length, 'alert')} and ${plural(p.recurring.length, 'regular charge')}. You spent ${money(s.spent, true)} and ${money(s.cameIn, true)} came in.</p>`
  $('alerts').innerHTML = `<h2>What looks off</h2>` + (p.alerts.length ? '<ul class="cards">' + p.alerts.map(a => `
    <li class="card k-${a.kind}"><h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p>
    <details><summary>The ${plural(a.txnIds.length, 'line')} behind it</summary><ul class="lines">${a.txnIds.slice(0, 12).map(id => {
      const t = p.txns[id]!
      return `<li><span>${formatDay(t.day)}</span><span>${esc(t.label)}</span><b>${money(-t.amount)}</b></li>`
    }).join('')}</ul></details></li>`).join('') + '</ul>' : '<p class="soft">Nothing stands out.</p>')
  $('regular').innerHTML = `<h2>Regular charges</h2>` + (p.recurring.length ? `<table><thead><tr><th>Merchant</th><th>How often</th><th class="n">Each</th><th class="n">Per year</th><th>Next</th></tr></thead><tbody>${p.recurring.map(r => `
    <tr class="${r.active ? '' : 'stopped'}"><td>${esc(r.label)}${r.rise ? ` <span class="tag">up ${money(r.rise.to - r.rise.from)}</span>` : ''}</td><td>${r.cadence}</td><td class="n">${money(r.typical)}</td><td class="n">${money(r.yearly, true)}</td><td>${r.active ? formatDay(r.nextDay, false) : 'stopped?'}</td></tr>`).join('')}</tbody></table>` : '<p class="soft">No charges that come round on a rhythm.</p>')
  const total = s.byCategory.reduce((a, c) => a + c.total, 0) || 1
  $('where').innerHTML = `<h2>Where it goes</h2><ul class="bars">${s.byCategory.map(c => `
    <li class="c-${c.id}"><span>${esc(category(c.id).label)}</span><i style="width:${Math.max(2, Math.round((c.total / total) * 100))}%"></i><b>${money(c.total, true)}</b></li>`).join('')}</ul>`
  const review = p.needsReview()
  $('review').innerHTML = `<h2>Needs a look</h2>` + (review.length ? `<p class="soft">Loose Change does not know these names. Pick a category, or ask the assistant to place them.</p><ul class="review">${review.map(r => `
    <li><span>${esc(r.label)} <small>${plural(r.lines, 'line')}, ${money(Math.round(r.total * 100))}</small></span>
    <select data-merchant="${esc(r.merchant)}" aria-label="Category for ${esc(r.label)}"><option value="">Choose…</option>${CATEGORIES.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></li>`).join('')}</ul>` : '<p class="soft">Every merchant was placed.</p>')
  const taught = p.taught()
  $('taught').innerHTML = taught.length ? `<h2>Your corrections</h2><ul class="review">${taught.map(t => `
    <li><span>${esc(t.label)} → ${esc(category(t.category).label)}</span><button type="button" class="btn quiet" data-forget="${esc(t.merchant)}">Undo</button></li>`).join('')}</ul>` : ''
}

function wire(): void {
  const drop = $('drop')
  const file = $<HTMLInputElement>('file')
  const take = async (f?: File | null) => {
    if (f) open(await f.text(), f.name)
  }
  drop.addEventListener('click', () => file.click())
  drop.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), file.click()))
  drop.addEventListener('dragover', e => (e.preventDefault(), drop.classList.add('over')))
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', e => {
    e.preventDefault()
    drop.classList.remove('over')
    void take(e.dataTransfer?.files[0])
  })
  file.addEventListener('change', () => void take(file.files?.[0]))
  $('try-sample').addEventListener('click', () => {
    const r = App.page.loadSample()
    if (!r.ok) toast(r.reason)
  })
  $('app').addEventListener('click', e => {
    const t = e.target as HTMLElement
    if (t.dataset.act === 'reset') App.page.reset()
    if (t.dataset.act === 'report') {
      const check = App.page.checkReport(App.page.version)
      if (check.ok) {
        downloadText('loose-change-report.md', App.page.reportMarkdown())
        toast('Saved loose-change-report.md')
      }
    }
    if (t.dataset.forget) App.page.forgetCategory(t.dataset.forget)
  })
  $('app').addEventListener('change', e => {
    const t = e.target as HTMLSelectElement
    if (t.dataset.merchant && t.value) {
      const r = App.page.setCategory(t.dataset.merchant, t.value)
      toast(r.ok ? `${r.label} is now ${category(r.category).label}` : r.reason)
    }
  })
  App.page.onChange(paint)
  paint()
}

if (typeof document !== 'undefined') {
  wire()
  // Show this site's own network address, so it can be copied into another agent site.
  const url = document.getElementById('network-url')
  if (url) url.textContent = new URL('loose_change_agent', document.baseURI).href
}
