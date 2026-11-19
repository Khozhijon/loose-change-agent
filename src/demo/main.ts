import {BUDGET} from './budget.ts'

const rows = BUDGET.map(b => `<tr><td>${b.line}</td><td class="n">$${b.usd}</td></tr>`).join('')
const total = BUDGET.reduce((a, b) => a + b.usd, 0)
document.getElementById('budget')!.innerHTML = `<table><thead><tr><th>Budget line</th><th class="n">Per month</th></tr></thead><tbody>${rows}<tr><th>Total</th><th class="n">$${total}</th></tr></tbody></table>`
