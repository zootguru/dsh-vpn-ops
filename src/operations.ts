import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getTarget } from './config.js'
import { PlanStore } from './plan-store.js'
import type { FileResult } from './process.js'
import { SshTransport } from './ssh.js'
import type { RemoteTransport } from './ssh.js'
import type {
  RemoteDeploymentConfig,
  ResolvedConfig,
  ResolvedTargetConfig,
} from './types.js'

export interface TargetSummary {
  readonly id: string
  readonly mutationEnabled: boolean
  readonly secretExportEnabled: boolean
  readonly clientIds: readonly string[]
}

export interface PreflightResult {
  readonly targetId: string
  readonly ready: boolean
  readonly osId: string
  readonly architecture: string
  readonly effectiveUid: number
  readonly missingCommands: readonly string[]
  readonly localPolicy: readonly string[]
}

export interface StatusResult {
  readonly targetId: string
  readonly deploymentId: string
  readonly backupId: string
  readonly stateFingerprint: string
  readonly wireguardActive: boolean
  readonly xrayActive: boolean
  readonly wireguardPeers: number
  readonly latestHandshakeEpoch: number
  readonly wireguardPortListening: boolean
  readonly vlessPortListening: boolean
}

export interface PlanResult {
  readonly targetId: string
  readonly planId: string
  readonly expiresAt: string
  readonly baselineDeploymentId: string
  readonly baselineStateFingerprint: string
  readonly changes: readonly string[]
  readonly mutationEnabled: boolean
  readonly confirmation: string
}

export interface VerifyResult {
  readonly targetId: string
  readonly ok: boolean
  readonly wireguardConfigValid: boolean
  readonly xrayConfigValid: boolean
  readonly servicesActive: boolean
  readonly portsListening: boolean
  readonly handshakesSeen: boolean
  readonly details: readonly string[]
}

export interface ApplyResult {
  readonly targetId: string
  readonly deploymentId: string
  readonly backupId: string
  readonly changed: boolean
  readonly remoteClientDirectory: string
  readonly verification: VerifyResult
}

export interface RollbackResult {
  readonly targetId: string
  readonly backupId: string
  readonly restored: boolean
  readonly verification: VerifyResult
}

export interface SecretExportResult {
  readonly targetId: string
  readonly clientId: string
  readonly deploymentId: string
  readonly files: readonly string[]
  readonly sha256: readonly string[]
  readonly bytes: readonly number[]
}

/** Narrow seam consumed by tool registration and replaced by runtime-path tests. */
export interface VpnOperationsApi {
  targets(): readonly TargetSummary[]
  preflight(targetId: string, signal: AbortSignal): Promise<PreflightResult>
  status(targetId: string, signal: AbortSignal): Promise<StatusResult>
  plan(targetId: string, signal: AbortSignal): Promise<PlanResult>
  apply(targetId: string, planId: string, confirmation: string, signal: AbortSignal): Promise<ApplyResult>
  verify(targetId: string, signal: AbortSignal): Promise<VerifyResult>
  rollback(targetId: string, backupId: string, confirmation: string, signal: AbortSignal): Promise<RollbackResult>
  exportClient(targetId: string, clientId: string, confirmation: string, signal: AbortSignal): Promise<SecretExportResult>
}

/** Safety-gated application service behind every model-facing tool. */
export class VpnOperations implements VpnOperationsApi {
  private readonly transport: RemoteTransport
  private readonly plans: PlanStore

  constructor(
    private readonly config: ResolvedConfig,
    transport?: RemoteTransport,
    plans?: PlanStore,
  ) {
    this.transport = transport ?? new SshTransport(config)
    this.plans = plans ?? new PlanStore(config)
  }

  targets(): readonly TargetSummary[] {
    return this.config.targets.map(target => ({
      id: target.id,
      mutationEnabled: this.config.allowMutations,
      secretExportEnabled: this.config.allowSecretExport,
      clientIds: target.clients.map(client => client.id),
    }))
  }

  async preflight(targetId: string, signal: AbortSignal): Promise<PreflightResult> {
    const target = getTarget(this.config, targetId)
    const remote = await this.transport.invoke(target, 'preflight', deploymentConfig(target, ''), signal)
    const missingCommands = csv(remote.missing_commands)
    const effectiveUid = integer(remote.effective_uid, 'effective_uid')
    const ready = remote.os_supported === 'true' && effectiveUid === 0 && missingCommands.length === 0
    return {
      targetId,
      ready,
      osId: required(remote, 'os_id'),
      architecture: required(remote, 'architecture'),
      effectiveUid,
      missingCommands,
      localPolicy: [
        'strict-host-key-checking',
        'public-key-only',
        'fixed-remote-helper',
        this.config.allowMutations ? 'mutations-enabled' : 'mutations-disabled',
      ],
    }
  }

  async status(targetId: string, signal: AbortSignal): Promise<StatusResult> {
    const target = getTarget(this.config, targetId)
    const remote = await this.transport.invoke(target, 'status', deploymentConfig(target, ''), signal)
    return statusFromRemote(targetId, remote)
  }

  async plan(targetId: string, signal: AbortSignal): Promise<PlanResult> {
    const target = getTarget(this.config, targetId)
    const preflight = await this.preflight(targetId, signal)
    if (!preflight.ready) {
      const missing = preflight.missingCommands.length > 0 ? `; missing: ${preflight.missingCommands.join(', ')}` : ''
      throw new Error(`target ${targetId} failed preflight (os=${preflight.osId}, uid=${preflight.effectiveUid})${missing}`)
    }
    const status = await this.status(targetId, signal)
    const record = await this.plans.create(target, status.deploymentId, status.stateFingerprint)
    return {
      targetId,
      planId: record.planId,
      expiresAt: record.expiresAt,
      baselineDeploymentId: record.baselineDeploymentId,
      baselineStateFingerprint: record.baselineStateFingerprint,
      changes: changeSet(target),
      mutationEnabled: this.config.allowMutations,
      confirmation: `APPLY ${targetId} ${record.planId}`,
    }
  }

  async apply(targetId: string, planId: string, confirmation: string, signal: AbortSignal): Promise<ApplyResult> {
    assertMutationsEnabled(this.config)
    const target = getTarget(this.config, targetId)
    if (confirmation !== `APPLY ${targetId} ${planId}`) throw new Error('confirmation does not exactly match the plan')
    const plan = await this.plans.readUsable(planId, target)
    const current = await this.status(targetId, signal)
    if (
      current.deploymentId !== plan.baselineDeploymentId
      || current.stateFingerprint !== plan.baselineStateFingerprint
    ) {
      throw new Error('remote deployment changed after planning; create a new plan')
    }
    const remote = await this.transport.invoke(target, 'apply', deploymentConfig(target, planId), signal)
    const deploymentId = required(remote, 'deployment_id')
    if (deploymentId !== planId) throw new Error('remote helper did not commit the requested plan')
    const backupId = required(remote, 'backup_id')
    await this.plans.consume(planId)
    const verification = await this.verify(targetId, signal)
    return {
      targetId,
      deploymentId,
      backupId,
      changed: boolean(remote.changed, 'changed'),
      remoteClientDirectory: `${target.remoteStateDirectory}/clients`,
      verification,
    }
  }

  async verify(targetId: string, signal: AbortSignal): Promise<VerifyResult> {
    const target = getTarget(this.config, targetId)
    const remote = await this.transport.invoke(target, 'verify', deploymentConfig(target, ''), signal)
    const wireguardConfigValid = boolean(remote.wireguard_config_valid, 'wireguard_config_valid')
    const xrayConfigValid = boolean(remote.xray_config_valid, 'xray_config_valid')
    const servicesActive = boolean(remote.services_active, 'services_active')
    const portsListening = boolean(remote.ports_listening, 'ports_listening')
    const handshakesSeen = boolean(remote.handshakes_seen, 'handshakes_seen')
    return {
      targetId,
      ok: wireguardConfigValid && xrayConfigValid && servicesActive && portsListening,
      wireguardConfigValid,
      xrayConfigValid,
      servicesActive,
      portsListening,
      handshakesSeen,
      details: csv(remote.details),
    }
  }

  async rollback(targetId: string, backupId: string, confirmation: string, signal: AbortSignal): Promise<RollbackResult> {
    assertMutationsEnabled(this.config)
    const target = getTarget(this.config, targetId)
    if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(backupId)) throw new Error('backupId has an invalid shape')
    if (confirmation !== `ROLLBACK ${targetId} ${backupId}`) throw new Error('confirmation does not exactly match the rollback')
    const remote = await this.transport.invoke(
      target,
      'rollback',
      deploymentConfig(target, ''),
      signal,
      { DSH_VPN_OPS_BACKUP_ID: backupId },
    )
    if (required(remote, 'backup_id') !== backupId) throw new Error('remote helper restored an unexpected backup')
    const verification = await this.verify(targetId, signal)
    return { targetId, backupId, restored: boolean(remote.restored, 'restored'), verification }
  }

  async exportClient(
    targetId: string,
    clientId: string,
    confirmation: string,
    signal: AbortSignal,
  ): Promise<SecretExportResult> {
    if (!this.config.allowSecretExport) throw new Error('secret export is disabled by plugin configuration')
    const target = getTarget(this.config, targetId)
    if (!target.clients.some(client => client.id === clientId)) throw new Error(`unknown clientId "${clientId}" for target ${targetId}`)
    if (confirmation !== `EXPORT ${targetId} ${clientId}`) throw new Error('confirmation does not exactly match the secret export')
    const status = await this.status(targetId, signal)
    if (status.deploymentId === '') throw new Error('target has no managed deployment to export')

    const directory = join(this.config.stateDirectory, 'exports', targetId, status.deploymentId, clientId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const wireguardPath = join(directory, 'wireguard.conf')
    const vlessPath = join(directory, 'vless.txt')
    const deployment = deploymentConfig(target, status.deploymentId)
    const extra = { DSH_VPN_OPS_CLIENT_ID: clientId }
    const written: string[] = []
    try {
      const wg = await this.transport.exportToFile(target, 'export-wireguard', deployment, wireguardPath, signal, extra)
      written.push(wireguardPath)
      const vless = await this.transport.exportToFile(target, 'export-vless', deployment, vlessPath, signal, extra)
      written.push(vlessPath)
      return exportResult(targetId, clientId, status.deploymentId, wireguardPath, vlessPath, wg, vless)
    } catch (error: unknown) {
      await Promise.all(written.map(path => rm(path, { force: true })))
      throw error
    }
  }
}

function deploymentConfig(target: ResolvedTargetConfig, planId: string): RemoteDeploymentConfig {
  return {
    schemaVersion: 1,
    targetId: target.id,
    planId,
    publicEndpoint: target.publicEndpoint,
    publicInterface: target.publicInterface,
    remoteStateDirectory: target.remoteStateDirectory,
    wireguardInterface: target.wireguardInterface,
    wireguardAddress: target.wireguardAddress,
    wireguardListenPort: target.wireguardListenPort,
    wireguardConfigPath: target.wireguardConfigPath,
    wireguardService: target.wireguardService,
    clientDns: target.clientDns,
    clientMtu: target.clientMtu,
    vlessListenAddress: target.vlessListenAddress,
    vlessPort: target.vlessPort,
    realityServerName: target.realityServerName,
    realityDestination: target.realityDestination,
    xrayBinary: target.xrayBinary,
    xrayConfigPath: target.xrayConfigPath,
    xrayService: target.xrayService,
    sysctlConfigPath: target.sysctlConfigPath,
    clients: target.clients,
  }
}

function changeSet(target: ResolvedTargetConfig): readonly string[] {
  return [
    `atomically replace ${target.wireguardConfigPath}`,
    `atomically replace ${target.xrayConfigPath}`,
    `enable IPv4 forwarding through ${target.sysctlConfigPath}`,
    `restart and enable ${target.wireguardService} and ${target.xrayService}`,
    `maintain ${target.clients.length} encrypted client identities under ${target.remoteStateDirectory}`,
    `create a rollback snapshot before the first write`,
  ]
}

function statusFromRemote(targetId: string, remote: Readonly<Record<string, string>>): StatusResult {
  return {
    targetId,
    deploymentId: remote.deployment_id ?? '',
    backupId: remote.backup_id ?? '',
    stateFingerprint: required(remote, 'state_fingerprint'),
    wireguardActive: boolean(remote.wireguard_active, 'wireguard_active'),
    xrayActive: boolean(remote.xray_active, 'xray_active'),
    wireguardPeers: integer(remote.wireguard_peers, 'wireguard_peers'),
    latestHandshakeEpoch: integer(remote.latest_handshake_epoch, 'latest_handshake_epoch'),
    wireguardPortListening: boolean(remote.wireguard_port_listening, 'wireguard_port_listening'),
    vlessPortListening: boolean(remote.vless_port_listening, 'vless_port_listening'),
  }
}

function exportResult(
  targetId: string,
  clientId: string,
  deploymentId: string,
  wireguardPath: string,
  vlessPath: string,
  wireguard: FileResult,
  vless: FileResult,
): SecretExportResult {
  return {
    targetId,
    clientId,
    deploymentId,
    files: [wireguardPath, vlessPath],
    sha256: [wireguard.sha256, vless.sha256],
    bytes: [wireguard.bytes, vless.bytes],
  }
}

function assertMutationsEnabled(config: ResolvedConfig): void {
  if (!config.allowMutations) throw new Error('remote mutations are disabled by plugin configuration')
}

function required(values: Readonly<Record<string, string>>, key: string): string {
  const value = values[key]
  if (value === undefined) throw new Error(`remote helper omitted ${key}`)
  return value
}

function boolean(value: string | undefined, field: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`remote helper returned invalid boolean ${field}`)
}

function integer(value: string | undefined, field: string): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`remote helper returned invalid integer ${field}`)
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error(`remote helper returned oversized integer ${field}`)
  return result
}

function csv(value: string | undefined): readonly string[] {
  return value === undefined || value === '' ? [] : value.split(',').filter(Boolean)
}
