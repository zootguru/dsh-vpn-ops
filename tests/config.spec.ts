import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { fixtureConfig } from './fixtures.js'

describe('configuration', () => {
  it('loads safely with no targets and mutations disabled', () => {
    const config = resolveConfig({})
    expect(config.targets).toEqual([])
    expect(config.allowMutations).toBe(false)
    expect(config.allowSecretExport).toBe(false)
    expect(config.stateDirectory).toMatch(/dsh-vpn-ops$/)
  })

  it('materializes all target defaults', () => {
    const target = fixtureConfig().targets[0]
    expect(target).toMatchObject({
      id: 'la-edge',
      sshPort: 22,
      remoteStateDirectory: '/var/lib/dsh-vpn-ops',
      wireguardInterface: 'wg0',
      wireguardAddress: '10.66.66.1/24',
      wireguardListenPort: 51820,
      wireguardService: 'wg-quick@wg0',
      vlessPort: 443,
      xrayService: 'xray',
    })
    expect(target?.clients).toHaveLength(2)
  })

  it.each([
    ['relative identity path', { identityFile: 'id_ed25519' }, /absolute local path/],
    ['unsafe host', { host: 'vpn.example.net;touch pwned' }, /invalid shape/],
    ['path traversal', { remoteStateDirectory: '/var/lib/../root' }, /normalized absolute POSIX path/],
    ['unsafe interface', { publicInterface: 'eth0;id' }, /invalid shape/],
    ['bad destination', { realityDestination: 'https://example.com' }, /DNS name followed by :port/],
  ])('rejects %s', (_label, targetOverride, message) => {
    const base = fixtureTarget()
    expect(() => resolveConfig({ targets: [{ ...base, ...targetOverride }] })).toThrow(message)
  })

  it('rejects clients outside the WireGuard network or duplicating the server', () => {
    const base = fixtureTarget()
    expect(() => resolveConfig({ targets: [{ ...base, clients: [{ id: 'bad', wireguardAddress: '10.66.67.2/32' }] }] }))
      .toThrow(/outside/)
    expect(() => resolveConfig({ targets: [{ ...base, clients: [{ id: 'bad', wireguardAddress: '10.66.66.1/32' }] }] }))
      .toThrow(/duplicates the server/)
  })

  it('rejects duplicate targets, clients, and client addresses', () => {
    const base = fixtureTarget()
    expect(() => resolveConfig({ targets: [base, base] })).toThrow(/duplicate target id/)
    expect(() => resolveConfig({ targets: [{ ...base, clients: [base.clients[0]!, base.clients[0]!] }] }))
      .toThrow(/duplicate .*client id/)
    expect(() => resolveConfig({
      targets: [{ ...base, clients: [
        { id: 'one', wireguardAddress: '10.66.66.2/32' },
        { id: 'two', wireguardAddress: '10.66.66.2/32' },
      ] }],
    })).toThrow(/duplicate .*client address/)
  })

  it('rejects invalid numeric policy bounds', () => {
    expect(() => resolveConfig({ commandTimeoutMs: 999 })).toThrow(/commandTimeoutMs/)
    expect(() => resolveConfig({ maxOutputBytes: 2_000_000 })).toThrow(/maxOutputBytes/)
    expect(() => resolveConfig({ planTtlSeconds: 1 })).toThrow(/planTtlSeconds/)
  })
})

function fixtureTarget() {
  return {
    id: 'la-edge',
    host: 'vpn.example.net',
    identityFile: '/tmp/id_ed25519',
    knownHostsFile: '/tmp/known_hosts',
    publicEndpoint: 'vpn.example.net',
    publicInterface: 'eth0',
    realityServerName: 'www.cloudflare.com',
    realityDestination: 'www.cloudflare.com:443',
    clients: [{ id: 'laptop', wireguardAddress: '10.66.66.2/32' }],
  }
}
