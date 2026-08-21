import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { PlanStore, targetDigest } from '../src/plan-store.js'
import { fixtureConfig } from './fixtures.js'

describe('PlanStore', () => {
  it('persists, validates, and consumes a plan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vpn-plan-'))
    const config = fixtureConfig({ stateDirectory: directory, planTtlSeconds: 60 })
    const store = new PlanStore(config, () => new Date('2026-08-21T12:00:00.000Z'))
    const target = config.targets[0]!
    const created = await store.create(target, 'old-deployment', 'state-one')

    expect(created.planId).toMatch(/^[a-f0-9]{64}$/)
    await expect(store.readUsable(created.planId, target)).resolves.toEqual(created)
    await store.consume(created.planId)
    await expect(store.readUsable(created.planId, target)).rejects.toThrow()
  })

  it('rejects expired, malformed, target-mismatched, and reconfigured plans', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vpn-plan-'))
    let now = new Date('2026-08-21T12:00:00.000Z')
    const config = fixtureConfig({ stateDirectory: directory, planTtlSeconds: 30 })
    const store = new PlanStore(config, () => now)
    const target = config.targets[0]!
    const created = await store.create(target, '', 'state-one')

    await expect(store.readUsable('not-a-plan', target)).rejects.toThrow(/planId/)
    now = new Date('2026-08-21T12:01:00.000Z')
    await expect(store.readUsable(created.planId, target)).rejects.toThrow(/expired/)

    const changed = resolveConfig({
      targets: [{
        ...target,
        wireguardListenPort: 51821,
        clients: [...target.clients],
      }],
      stateDirectory: directory,
    }).targets[0]!
    now = new Date('2026-08-21T12:00:01.000Z')
    await expect(store.readUsable(created.planId, changed)).rejects.toThrow(/configuration changed/)
  })

  it('produces stable target digests', () => {
    const target = fixtureConfig().targets[0]!
    expect(targetDigest(target)).toBe(targetDigest(target))
    expect(targetDigest({ ...target, vlessPort: 8443 })).not.toBe(targetDigest(target))
  })
})
