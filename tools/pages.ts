// Assembles the folder GitHub Pages publishes: the site at the root, the demo caller at /pocketbook/.
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const out = path.join(root, '_pages')
fs.rmSync(out, {recursive: true, force: true})
fs.cpSync(path.join(root, 'site'), out, {recursive: true, dereference: true})
fs.cpSync(path.join(root, 'demo/pocketbook'), path.join(out, 'pocketbook'), {recursive: true, dereference: true})
fs.writeFileSync(path.join(out, '.nojekyll'), '')
console.log('assembled _pages/')
