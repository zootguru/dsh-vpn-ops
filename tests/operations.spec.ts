import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { VpnOperations } from '../src/operations.js'
import { PlanStore } from '../src/plan-store.js'
import type { FileResult } from '../src/process.js'
import type { RemoteAction, RemoteTransport } from '../src/ssh.js'
import type { RemoteDeploymentConfig, ResolvedTargetConfig } from '../src/types.js'
import { fixtureConfig } from './fixtures.js'

class ScenarioTransport implements RemoteTransport {
  deploymentId = ''
  stateFingerprint = 'f'.repeat(64)
  readonly calls: RemoteAction[] = []

  async invoke(
    _target: ResolvedTargetConfig,
    action: RemoteAction,
    deployment: RemoteDeploymentConfig | undefined,
    _signal: AbortSignal,
    extra: Readonly<Record<string, string>> = {},
  ): Promise<Readonly<Record<string, string>>> {
    this.calls.push(action)
    if (action === 'preflight') return response({ os_id: 'ubuntu', os_supported: 'true', architecture: 'x86_64', effective_uid: '0', missing_commands: '' })
    if (action === 'status') return statusResponse(this.deploymentId)
    if (action === 'apply') {
      this.deploymentId = deployment?.planId ?? ''
      return response({ deployment_id: this.deploymentId, backup_id: '20260821T120000Z-1234abcd', changed: 'true' })
    }
    if (action === 'verify') return response({
      wireguard_config_valid: 'true', xray_config_valid: 'true', services_active: 'true',
      ports_listening: 'true', handshakes_seen: 'false', details: 'wireguard-config-ok,no-handshake-yet',
    })
    if (action === 'rollback') {
      this.deploymentId = ''
      return response({ backup_id: extra.DSH_VPN_OPS_BACKUP_ID ?? '', restored: 'true' })
    }
    throw new Error(`unexpected action ${action}`)
  }

  async exportToFile(): Promise<FileResult> {
    return { bytes: 12, sha256: 'a'.repeat(64), stderr: '', truncated: false }
  }
}

describe('VpnOperations', () => {
  it('runs preflight -> plan -> apply -> verify and consumes the plan', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'dsh-vpn-ops-'))
    const config = fixtureConfig({ stateDirectory, allowMutations: true })
    const transport = new ScenarioTransport()
    const clock = () => new Date('2026-08-21T12:00:00.000Z')
    const operations = new VpnOperations(config, transport, new PlanStore(config, clock))
    const signal = new AbortController().signal

    const preflight = await operations.preflight('la-edge', signal)
    expect(preflight).toMatchObject({ ready: true, effectiveUid: 0, missingCommands: [] })
    const plan = await operations.plan('la-edge', signal)
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.confirmation).toBe(`APPLY la-edge ${plan.planId}`)
    const applied = await operations.apply('la-edge', plan.planId, plan.confirmation, signal)
    expect(applied).toMatchObject({ changed: true, backupId: '20260821T120000Z-1234abcd' })
    expect(applied.verification.ok).toBe(true)
    await expect(operations.apply('la-edge', plan.planId, plan.confirmation, signal)).rejects.toThrow()
    expect(transport.calls).toEqual(['preflight', 'preflight', 'status', 'status', 'apply', 'verify'])
  })

  it('fails closed on disabled mutation, wrong confirmation, stale baseline, and failed preflight', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'dsh-vpn-ops-'))
    const disabledConfig = fixtureConfig({ stateDirectory })
    const disabled = new VpnOperations(disabledConfig, new ScenarioTransport(), new PlanStore(disabledConfig))
    await expect(disabled.apply('la-edge', '0'.repeat(64), '', new AbortController().signal)).rejects.toThrow(/disabled/)

    const config = fixtureConfig({ stateDirectory: `${stateDirectory}-enabled`, allowMutations: true })
    const transport = new ScenarioTransport()
    const operations = new VpnOperations(config, transport, new PlanStore(config))
    const plan = await operations.plan('la-edge', new AbortController().signal)
    await expect(operations.apply('la-edge', plan.planId, 'yes', new AbortController().signal)).rejects.toThrow(/confirmation/)
    transport.deploymentId = 'changed-elsewhere'
    await expect(operations.apply('la-edge', plan.planId, plan.confirmation, new AbortController().signal)).rejects.toThrow(/changed after planning/)

    const failingTransport = new ScenarioTransport()
    failingTransport.invoke = async () => response({ os_id: 'alpine', os_supported: 'false', architecture: 'x86_64', effective_uid: '1000', missing_commands: 'xray,jq' })
    const failing = new VpnOperations(config, failingTransport, new PlanStore(config))
    await expect(failing.plan('la-edge', new AbortController().signal)).rejects.toThrow(/failed preflight.*missing: xray, jq/)
  })

  it('validates rollback identity and confirmation, then verifies', async () => {
    const config = fixtureConfig({ allowMutations: true })
    const transport = new ScenarioTransport()
    const operations = new VpnOperations(config, transport)
    const signal = new AbortController().signal
    const backupId = '20260821T120000Z-1234abcd'
    await expect(operations.rollback('la-edge', '../bad', '', signal)).rejects.toThrow(/invalid shape/)
    await expect(operations.rollback('la-edge', backupId, 'yes', signal)).rejects.toThrow(/confirmation/)
    const result = await operations.rollback('la-edge', backupId, `ROLLBACK la-edge ${backupId}`, signal)
    expect(result.restored).toBe(true)
    expect(result.verification.ok).toBe(true)
  })

  it('lists only non-secret target and client ids', () => {
    const operations = new VpnOperations(fixtureConfig())
    expect(operations.targets()).toEqual([{ id: 'la-edge', mutationEnabled: false, secretExportEnabled: false, clientIds: ['laptop', 'phone'] }])
    expect(JSON.stringify(operations.targets())).not.toContain('vpn.example.net')
  })
})

function response(values: Readonly<Record<string, string>>) {
  return Object.freeze({ schema: '1', ...values })
}

function statusResponse(deploymentId: string) {
  return response({
    deployment_id: deploymentId, backup_id: '', state_fingerprint: 'f'.repeat(64), wireguard_active: 'false', xray_active: 'false',
    wireguard_peers: '0', latest_handshake_epoch: '0', wireguard_port_listening: 'false', vless_port_listening: 'false',
  })
}
