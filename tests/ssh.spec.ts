import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { CommandRunner, FileResult, RunOptions } from '../src/process.js'
import { SshTransport, parseKeyValue } from '../src/ssh.js'
import type { ProcessResult } from '../src/types.js'
import { resolveConfig } from '../src/config.js'

class RecordingRunner implements CommandRunner {
  command = ''
  args: readonly string[] = []
  input = ''

  async run(command: string, args: readonly string[], options: RunOptions): Promise<ProcessResult> {
    this.command = command
    this.args = args
    this.input = options.input ?? ''
    return { exitCode: 0, stdout: 'schema=1\nos_id=ubuntu\n', stderr: '', truncated: false }
  }

  async runToFile(): Promise<FileResult> {
    return { bytes: 1, sha256: '0'.repeat(64), stderr: '', truncated: false }
  }
}

describe('SSH transport', () => {
  it('uses argv-only strict SSH policy and the fixed helper', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vpn-ssh-'))
    const identity = join(directory, 'id_ed25519')
    const knownHosts = join(directory, 'known_hosts')
    await writeFile(identity, 'private-placeholder', { mode: 0o600 })
    await chmod(identity, 0o600)
    await writeFile(knownHosts, 'vpn.example.net ssh-ed25519 AAAATEST\n')
    const config = configWithFiles(identity, knownHosts)
    const runner = new RecordingRunner()
    const transport = new SshTransport(config, runner)
    const target = config.targets[0]!
    const result = await transport.invoke(target, 'preflight', deployment(target), new AbortController().signal)

    expect(result.os_id).toBe('ubuntu')
    expect(runner.command).toBe('ssh')
    expect(runner.args).toContain('StrictHostKeyChecking=yes')
    expect(runner.args).toContain('PasswordAuthentication=no')
    expect(runner.args.join(' ')).not.toContain('StrictHostKeyChecking=no')
    expect(runner.input).toContain('Fixed remote helper for dsh-vpn-ops')
    expect(runner.args.at(-2)).toBe('root@vpn.example.net')
    expect(runner.args.at(-1)).toContain('DSH_VPN_OPS_CONFIG_B64=')
  })

  it('rejects an identity file readable by group or others', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vpn-ssh-'))
    const identity = join(directory, 'id_ed25519')
    const knownHosts = join(directory, 'known_hosts')
    await writeFile(identity, 'private-placeholder', { mode: 0o644 })
    await chmod(identity, 0o644)
    await writeFile(knownHosts, 'host key\n')
    const config = configWithFiles(identity, knownHosts)
    const transport = new SshTransport(config, new RecordingRunner())
    await expect(transport.invoke(config.targets[0]!, 'preflight', undefined, new AbortController().signal))
      .rejects.toThrow(/group or others/)
  })

  it('parses only the bounded key-value response protocol', () => {
    expect(parseKeyValue('schema=1\nready=true\n')).toEqual({ schema: '1', ready: 'true' })
    expect(() => parseKeyValue('schema=1\nschema=1\n')).toThrow(/duplicate/)
    expect(() => parseKeyValue('schema=2\n')).toThrow(/unsupported/)
    expect(() => parseKeyValue('schema=1\nnot a pair\n')).toThrow(/invalid response line/)
  })
})

function configWithFiles(identityFile: string, knownHostsFile: string) {
  return resolveConfig({
    targets: [{
      id: 'edge', host: 'vpn.example.net', identityFile, knownHostsFile,
      publicEndpoint: 'vpn.example.net', publicInterface: 'eth0',
      realityServerName: 'www.cloudflare.com', realityDestination: 'www.cloudflare.com:443',
      clients: [{ id: 'phone', wireguardAddress: '10.66.66.2/32' }],
    }],
  })
}

function deployment(target: ReturnType<typeof configWithFiles>['targets'][number]) {
  return {
    schemaVersion: 1 as const, targetId: target.id, planId: '', publicEndpoint: target.publicEndpoint,
    publicInterface: target.publicInterface, remoteStateDirectory: target.remoteStateDirectory,
    wireguardInterface: target.wireguardInterface, wireguardAddress: target.wireguardAddress,
    wireguardListenPort: target.wireguardListenPort, wireguardConfigPath: target.wireguardConfigPath,
    wireguardService: target.wireguardService, clientDns: target.clientDns, clientMtu: target.clientMtu,
    vlessListenAddress: target.vlessListenAddress, vlessPort: target.vlessPort,
    realityServerName: target.realityServerName, realityDestination: target.realityDestination,
    xrayBinary: target.xrayBinary, xrayConfigPath: target.xrayConfigPath, xrayService: target.xrayService,
    sysctlConfigPath: target.sysctlConfigPath, clients: target.clients,
  }
}
