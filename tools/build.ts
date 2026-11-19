// Bundles the page, the assistant, the site actions and the bridge actions into site/, and the demo
// caller (Pocketbook) into demo/pocketbook/. Entries share chunks, so the page, the actions and the
// bridge see the same modules.
//
//   npm run build
import fs from 'node:fs'
import path from 'node:path'
import {build} from 'esbuild'

const root = path.join(import.meta.dirname, '..')
const out = path.join(root, 'site')

const common = {
  bundle: true,
  splitting: true,
  format: 'esm' as const,
  platform: 'browser' as const,
  target: 'es2022',
  chunkNames: 'chunks/[name]-[hash]',
  sourcemap: false,
  logLevel: 'warning' as const,
  legalComments: 'none' as const,
  // The assistant boots the runtime with a dynamic import that must stay as written.
  external: ['./runtime/*'],
}

await build({
  ...common,
  entryPoints: {
    main: path.join(root, 'src/page/main.ts'),
    site: path.join(root, 'src/assistant/site.js'),
    'site-actions': path.join(root, 'src/actions/site-actions.ts'),
    'bridge/bridge-actions': path.join(root, 'src/bridge/bridge-actions.ts'),
  },
  outdir: out,
})
console.log('built site/')

// The demo caller site (Pocketbook): same runtime, its own bundle, plus the shared stylesheet.
const demo = path.join(root, 'demo/pocketbook')
await build({
  ...common,
  entryPoints: {
    main: path.join(root, 'src/demo/main.ts'),
    site: path.join(root, 'src/demo/site.js'),
    'site-actions': path.join(root, 'src/demo/site-actions.ts'),
  },
  outdir: demo,
})
fs.cpSync(path.join(out, 'runtime'), path.join(demo, 'runtime'), {recursive: true})
fs.copyFileSync(path.join(out, 'style.css'), path.join(demo, 'style.css'))
console.log('built demo/pocketbook/')
