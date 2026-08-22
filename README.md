# dsh-vpn-ops

[简体中文](README.zh-CN.md)

Safety-gated WireGuard and VLESS Reality operations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

`dsh-vpn-ops` is a real DSH bundle: it ships `cordis.patch.yml`, exports a Cordis
`apply(ctx, config)` lifecycle entry point, and registers eight typed tools. It
turns a reviewed, allowlisted server definition into repeatable preflight,
plan, apply, status, verification, rollback, and client-export operations.

> Status: `0.1.0` initial public release. The bundle load path is verified against
> DSH `0.1.1-rc.2`; production network rollout still requires an operator-owned
> staging server and acceptance test. See [Compatibility](#compatibility) and
> [Limitations](#limitations).

## Why this is not “SSH from the model”

The model can choose only a configured `targetId` and `clientId`. It cannot
supply a host, credential, remote path, package URL, or shell command.

- Strict host-key checking and public-key-only SSH are mandatory.
- Every process is spawned with an argv array; no local shell is used.
- Remote work runs a fixed helper shipped in the reviewed package.
- Remote mutation defaults to off.
- `vpn_apply` requires a fresh, persisted plan, an unchanged remote baseline,
  and the exact confirmation string returned by `vpn_plan`.
- Apply writes backups before the first managed-file change and automatically
  restores them if the transaction fails.
- Client secrets are never returned as tool values. Explicit export streams
  them into new local mode-`0600` files and returns only paths, sizes, and
  SHA-256 evidence.
- The npm package has no `preinstall`, `install`, `postinstall`, `prepare`, or
  `prepack` lifecycle script.

Read the complete [threat model](docs/THREAT_MODEL.md) before enabling changes.

## Tools

| Tool | Changes state | Gate |
| --- | --- | --- |
| `vpn_targets` | No | None |
| `vpn_preflight` | No | Allowlisted target |
| `vpn_status` | No | Allowlisted target |
| `vpn_plan` | Local non-secret plan file | Preflight must pass |
| `vpn_apply` | Yes, remote | `allowMutations`, fresh plan, exact confirmation |
| `vpn_verify` | No | Allowlisted target |
| `vpn_rollback` | Yes, remote | `allowMutations`, backup id, exact confirmation |
| `vpn_export_client` | Yes, local secret files | `allowSecretExport`, exact confirmation |

## Target prerequisites

The first release intentionally does not install operating-system packages or
download Xray. Supply-chain policy remains with the server operator.

The target must be Debian or Ubuntu with systemd and these commands already
available:

```text
base64 flock install ip iptables jq mktemp openssl sha256sum ss sysctl systemctl
uuidgen wg wg-quick xray
```

The configured `xrayBinary` may point to a non-PATH installation. The SSH user
must be root, or `sudo: true` must provide non-interactive root authority.
Treat either credential as root-equivalent and keep it dedicated.

Before deployment, verify that:

1. UDP `wireguardListenPort` and TCP `vlessPort` are allowed by the provider and
   host firewalls.
2. `publicInterface` is the actual egress interface.
3. The REALITY `realityDestination` and `realityServerName` are suitable and
   under an acceptable abuse policy. Unauthenticated REALITY traffic is
   forwarded to the target; see the Xray documentation warning.
4. Xray accepts `network: "raw"`, the `target` REALITY field, and
   `xtls-rprx-vision` in a dry-run configuration test.
5. The operator has an independent recovery channel such as a cloud serial
   console.

## Install

### GitHub release

Install a tagged release into an existing DSH profile:

```sh
dsh plugin --profile my-profile add github:zootguru/dsh-vpn-ops#v0.1.0
```

The repository commits built `lib/` artifacts, so a Git install does not run a
build lifecycle hook.

### Local, reproducible tarball

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination ./artifacts
dsh plugin --profile my-profile add ./artifacts/dsh-vpn-ops-0.1.0.tgz
```

## Configure

The bundle installs a disabled `vpn-ops` row. Override that row in the profile's
user `cordis.patch.yml`:

```yaml
- id: vpn-ops
  config:
    # Keep false until a reviewed vpn_plan is ready to execute.
    allowMutations: false
    # Enable only for an operator-approved client export session.
    allowSecretExport: false
    stateDirectory: /Users/operator/.local/state/dsh-vpn-ops
    connectTimeoutSeconds: 10
    commandTimeoutMs: 120000
    maxOutputBytes: 65536
    planTtlSeconds: 900
    targets:
      - id: la-edge
        host: vpn.example.net
        user: root
        sshPort: 22
        identityFile: /Users/operator/.ssh/dsh-vpn-ops_ed25519
        knownHostsFile: /Users/operator/.ssh/dsh-vpn-ops_known_hosts
        sudo: false
        publicEndpoint: vpn.example.net
        publicInterface: eth0
        remoteStateDirectory: /var/lib/dsh-vpn-ops

        wireguardInterface: wg0
        wireguardAddress: 10.66.66.1/24
        wireguardListenPort: 51820
        wireguardConfigPath: /etc/wireguard/wg0.conf
        wireguardService: wg-quick@wg0
        clientDns: 1.1.1.1
        clientMtu: 1420

        vlessListenAddress: 0.0.0.0
        vlessPort: 443
        realityServerName: www.example.com
        realityDestination: www.example.com:443
        xrayBinary: /usr/local/bin/xray
        xrayConfigPath: /usr/local/etc/xray/config.json
        xrayService: xray
        sysctlConfigPath: /etc/sysctl.d/99-dsh-vpn-ops.conf

        clients:
          - id: laptop
            wireguardAddress: 10.66.66.2/32
          - id: phone
            wireguardAddress: 10.66.66.3/32
```

`identityFile` must be a regular file inaccessible to group and others.
`knownHostsFile` must be non-empty. Obtain the host key through the provider or
another authenticated channel; do not trust an unverified `ssh-keyscan` result.

No example contains a real server address, UUID, private key, or client config.

## Operate

Use this order:

1. `vpn_targets`
2. `vpn_preflight({ targetId: "la-edge" })`
3. `vpn_status({ targetId: "la-edge" })`
4. `vpn_plan({ targetId: "la-edge" })`
5. Review every change, the baseline deployment id, and the managed-state
   fingerprint. Any managed-file or service-state drift invalidates the plan.
6. Set `allowMutations: true`, let DSH reload the plugin, and call `vpn_apply`
   with the exact plan id and confirmation returned in step 4.
7. Read the returned backup id and verification result. A missing first
   handshake is informational; invalid configuration, inactive services, or
   closed listeners makes verification fail.
8. Set `allowMutations: false` again.

To export a configured client, temporarily enable `allowSecretExport`, obtain
explicit operator approval for `EXPORT <targetId> <clientId>`, call
`vpn_export_client`, move the generated files into an approved secret channel,
then disable export and remove the local copies when no longer needed.

Rollback requires the exact `backupId` and confirmation
`ROLLBACK <targetId> <backupId>`.

## What apply manages

- WireGuard server and per-client X25519 keys.
- VLESS UUIDs and REALITY key material.
- WireGuard server configuration and client profiles.
- Xray VLESS + REALITY inbound configuration.
- IPv4 forwarding sysctl configuration.
- Service enable/restart for the configured WireGuard and Xray units.
- Per-apply backups and a current deployment marker under
  `remoteStateDirectory`.

Keys are generated on the target and remain under
`remoteStateDirectory/secrets` with restrictive permissions. Existing managed
keys are reused so repeated applies do not silently invalidate clients.

## Compatibility

| Component | Verified contract |
| --- | --- |
| DeepSeek Harness | `0.1.1-rc.2` |
| `@deepseek-ai/dsh-tools` | `0.1.1-rc.2` exact peer |
| `@deepseek-ai/cordis` | `4.0.1` exact peer |
| Node.js | `^22.19.0` or `>=24.0.0` |
| Remote OS | Debian / Ubuntu with systemd |
| Xray configuration | Current `target`, `password`, and `raw` terminology; runtime preflight and dry-run required |

DSH is a developer preview and may make breaking changes. Compatibility is an
evidence statement, not a broad semver promise. The exact clean-profile
procedure and results live in [Verification](docs/VERIFICATION.md).

## Limitations

- No package installation, firewall-provider API, DNS update, cloud console, or
  certificate management.
- IPv4 WireGuard topology only; no IPv6 forwarding.
- Full-tunnel clients only (`AllowedIPs = 0.0.0.0/0`).
- One WireGuard interface and one VLESS Reality inbound per target.
- Service health and local listeners are verified; an end-to-end test from an
  independent external network remains the operator's responsibility.
- Client export writes secret material to the DSH host. The plugin does not send
  it to email, chat, cloud storage, or the model.
- Rollback covers managed configuration, client artifacts, sysctl, and prior
  service activity. It cannot reverse external firewall, provider, DNS, or
  routing changes because it never performs them.

## Uninstall

Disable mutations, remove the bundle, and inspect the target manually before
deleting remote state:

```sh
dsh plugin --profile my-profile remove dsh-vpn-ops
```

Uninstall intentionally does not delete remote configuration, keys, backups, or
client files.

## Development and evidence

```sh
pnpm install --frozen-lockfile
pnpm test:coverage
pnpm verify
```

The repository publishes:

- a lockfile and exact DSH compatibility peers;
- TypeScript declarations and built ESM;
- unit, failure-path, static security, transport, plan, and tool-surface tests;
- package and shell syntax gates;
- a CI matrix for supported Node lines;
- [security policy](SECURITY.md), [threat model](docs/THREAT_MODEL.md),
  [verification evidence](docs/VERIFICATION.md), and
  [release checklist](docs/RELEASE.md).

## License

MIT
