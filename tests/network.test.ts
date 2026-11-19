import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {registerActions as pageActions} from '../src/actions/site-actions.ts'
import {registerActions as bridgeActions} from '../src/bridge/bridge-actions.ts'

const site = new URL('../site/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('agent-manifest.json', site), 'utf8'))

function collect(register: (r: {register(d: unknown): void}) => void): any[] {
  const list: any[] = []
  register({register: d => list.push(d)})
  return list
}

test('every tool in the manifest is registered by the page or the bridge, and every action is listed', () => {
  const page = collect(pageActions)
  const bridge = collect(bridgeActions)
  const names = [...page, ...bridge].map(a => a.name).sort()
  assert.deepEqual(names, [...manifest.actions.agentTools].sort())
})

test('page actions are local, bridge actions are bridge-only with caller origins', () => {
  for (const a of collect(bridgeActions)) {
    assert.equal(a.availability, 'bridge')
    assert.ok(Array.isArray(a.callerOrigins) && a.callerOrigins.length > 0)
  }
  for (const a of collect(pageActions)) assert.notEqual(a.availability, 'bridge')
})

test('irreversible and write actions say when to call them', () => {
  for (const a of collect(pageActions)) {
    if (a.effect !== 'read') assert.match(a.description, /only when the visitor (asks|agrees)|Call it only when/i, a.name)
  }
})

test('sample queries in the HOCON and the manifest match', () => {
  const net = JSON.parse(readFileSync(new URL('loose_change_agent.network.json', site), 'utf8'))
  assert.deepEqual(net.metadata.sample_queries, manifest.networks[0].sample_queries)
})

test('the bridge categorise tool runs and keeps nothing', () => {
  const tool = collect(bridgeActions).find(a => a.name === 'categorise_merchants')
  const r = tool.execute({items: [{description: 'SPOTIFY USA 877-7781161'}]})
  assert.equal(r.results[0].category, 'subscriptions')
})
