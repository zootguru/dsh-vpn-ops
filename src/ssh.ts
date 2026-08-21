import { readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CommandRunner, FileResult } from './process.js'
import { LocalCommandRunner, processFailure } from './process.js'
import type { ProcessResult, RemoteDeploymentConfig, ResolvedConfig, ResolvedTargetConfig } from './types.js'

export type RemoteAction = 'preflight' | 'status' | 'verify' | 'apply' | 'rollback' | 'export-wireguard' | 'export-vless'

export interface RemoteTransport {
  invoke(
    target: ResolvedTargetConfig,
    action: RemoteAction,
    deployment: RemoteDeploymentConfig | undefined,
    signal: AbortSignal,
    extra?: Readonly<Record<string, string>>,
  ): Promise<Readonly<Record<string, string>>>
  exportToFile(
    target: ResolvedTargetConfig,
    action: 'export-wireguard' | 'export-vless',
    deployment: RemoteDeploymentConfig,
    destination: string,
    signal: AbortSignal,
    extra: Readonly<Record<string, string>>,
  ): Promise<FileResult>
}

/** Fixed-script SSH transport with strict host-key and public-key-only policy. */
export class SshTransport implements RemoteTransport {
  readonly #helperUrl = new URL('../assets/remote/dsh-vpn-ops.sh', import.meta.url)

  constructor(
    private readonly config: ResolvedConfig,
    private readonly runner: CommandRunner = new LocalCommandRunner(),
  ) {}

  async invoke(
    target: ResolvedTargetConfig,
    action: RemoteAction,
    deployment: RemoteDeploymentConfig | undefined,
    signal: AbortSignal,
    extra: Readonly<Record<string, string>> = {},
  ): Promise<Readonly<Record<string, string>>> {
    await assertSshFiles(target)
    const helper = await readFile(this.#helperUrl, 'utf8')
    const result = await this.runner.run('ssh', sshArgs(this.config, target, action, deployment, extra), {
      input: helper,
      signal,
      timeoutMs: this.config.commandTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
    })
    assertSuccess('ssh', result)
    return parseKeyValue(result.stdout)
  }

  async exportToFile(
    target: ResolvedTargetConfig,
    action: 'export-wireguard' | 'export-vless',
    deployment: RemoteDeploymentConfig,
    destination: string,
    signal: AbortSignal,
    extra: Readonly<Record<string, string>>,
  ): Promise<FileResult> {
    await assertSshFiles(target)
    await stat(dirname(destination))
    const helper = await readFile(this.#helperUrl, 'utf8')
    return this.runner.runToFile('ssh', sshArgs(this.config, target, action, deployment, extra), destination, {
      input: helper,
      signal,
      timeoutMs: this.config.commandTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
    })
  }
}

function sshArgs(
  config: ResolvedConfig,
  target: ResolvedTargetConfig,
  action: RemoteAction,
  deployment: RemoteDeploymentConfig | undefined,
  extra: Readonly<Record<string, string>>,
): string[] {
  const environment: Record<string, string> = {
    DSH_VPN_OPS_ACTION: action,
    DSH_VPN_OPS_CONFIG_B64: deployment === undefined ? '' : Buffer.from(JSON.stringify(deployment)).toString('base64'),
    ...extra,
  }
  const remoteTokens = [
    ...(target.sudo ? ['sudo', '-n'] : []),
    'env',
    ...Object.entries(environment).map(([key, value]) => `${key}=${shellQuote(value)}`),
    '/bin/sh',
    '-s',
  ]
  return [
    '-F', '/dev/null',
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${target.knownHostsFile}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', `IdentityFile=${target.identityFile}`,
    '-o', `ConnectTimeout=${config.connectTimeoutSeconds}`,
    '-o', 'ClearAllForwardings=yes',
    '-o', 'PermitLocalCommand=no',
    '-o', 'ControlMaster=no',
    '-o', 'LogLevel=ERROR',
    '-p', String(target.sshPort),
    `${target.user}@${target.host}`,
    remoteTokens.join(' '),
  ]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function assertSshFiles(target: ResolvedTargetConfig): Promise<void> {
  const [identity, knownHosts] = await Promise.all([stat(target.identityFile), stat(target.knownHostsFile)])
  if (!identity.isFile()) throw new Error(`${target.id}: identityFile is not a regular file`)
  if ((identity.mode & 0o077) !== 0) throw new Error(`${target.id}: identityFile must not be accessible by group or others`)
  if (!knownHosts.isFile() || knownHosts.size === 0) throw new Error(`${target.id}: knownHostsFile must be a non-empty regular file`)
}

function assertSuccess(command: string, result: ProcessResult): void {
  if (result.exitCode !== 0) throw processFailure(command, result.exitCode, result.stderr, result.truncated)
  if (result.truncated) throw new Error(`${command} output exceeded the configured bound`)
}

/** Parse the helper's deliberately tiny, newline-delimited response protocol. */
export function parseKeyValue(output: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line === '') continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error('remote helper returned an invalid response line')
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    if (!/^[a-z][a-z0-9_]*$/.test(key) || Object.hasOwn(result, key)) {
      throw new Error('remote helper returned an invalid or duplicate response key')
    }
    if (value.includes('\0') || value.length > 8_192) throw new Error(`remote helper value for ${key} is invalid`)
    result[key] = value
  }
  if (result.schema !== '1') throw new Error('remote helper response schema is unsupported')
  return Object.freeze(result)
}
