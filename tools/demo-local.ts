// Prepares the demo caller for a local, truly cross-origin try-out: Pocketbook on http://localhost:8081
// calls Loose Change on http://127.0.0.1:8080 (two different origins, as on the open web).
//
//   npm run build && npm run serve                      (Loose Change, in one terminal)
//   npm run demo                                        (this script, then serve the folder it prints)
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const out = path.join(root, '_local-demo/pocketbook')
const PUBLIC = 'https://khozhijon.github.io/loose-change-agent'
const LOCAL = 'http://127.0.0.1:8080'

fs.rmSync(path.dirname(out), {recursive: true, force: true})
fs.cpSync(path.join(root, 'demo/pocketbook'), out, {recursive: true, dereference: true})
for (const file of ['pocketbook_coach.hocon', 'agent-manifest.json']) {
  const p = path.join(out, file)
  let text = fs.readFileSync(p, 'utf8')
  text = text.replaceAll(`${PUBLIC}/loose_change_agent`, `${LOCAL}/loose_change_agent`)
  text = text.replaceAll('"https://khozhijon.github.io"', `"${LOCAL}"`)
  // The tool's name comes from the URL path: shorter here, so the instructions must follow.
  text = text.replaceAll('loose_change_agent_loose_change_agent', 'loose_change_agent')
  fs.writeFileSync(p, text)
}
execFileSync(process.execPath, [path.join(root, 'tools/agentify-skill/scripts/build_network.mjs'), path.join(out, 'pocketbook_coach.hocon'), '--manifest', path.join(out, 'agent-manifest.json')], {stdio: 'inherit'})
console.log(`\nServe it with:\n  node tools/agentify-skill/scripts/serve_site.mjs _local-demo/pocketbook --port 8081 --open-as localhost\nthen open http://localhost:8081/`)
