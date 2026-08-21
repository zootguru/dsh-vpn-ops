import type { Config, ResolvedConfig } from '../src/types.js'
import { resolveConfig } from '../src/config.js'

export function fixtureConfig(overrides: Partial<Config> = {}): ResolvedConfig {
  return resolveConfig({
    targets: [{
      id: 'la-edge',
      host: 'vpn.example.net',
      user: 'root',
      identityFile: '/tmp/dsh-vpn-ops-test/id_ed25519',
      knownHostsFile: '/tmp/dsh-vpn-ops-test/known_hosts',
      publicEndpoint: 'vpn.example.net',
      publicInterface: 'eth0',
      realityServerName: 'www.cloudflare.com',
      realityDestination: 'www.cloudflare.com:443',
      clients: [
        { id: 'laptop', wireguardAddress: '10.66.66.2/32' },
        { id: 'phone', wireguardAddress: '10.66.66.3/32' },
      ],
    }],
    stateDirectory: '/tmp/dsh-vpn-ops-test/state',
    ...overrides,
  })
}
