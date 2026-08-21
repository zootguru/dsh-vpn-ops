# Threat model

## Assets

- SSH private key and authenticated host-key database on the DSH host.
- WireGuard private keys, VLESS UUIDs, REALITY private key, and client profiles.
- Root-managed WireGuard, Xray, and sysctl configuration on each target.
- Availability of the SSH target and its recovery channel.
- Integrity of the DSH profile, plugin package, lockfile, and built artifacts.

## Trust boundaries

1. The human operator owns plugin configuration and feature gates.
2. The model supplies typed tool arguments but is not trusted with arbitrary
   hosts, paths, credentials, or commands.
3. DSH and this plugin run with the local user's authority.
4. SSH authenticates the configured target using an operator-pinned host key.
5. The fixed helper crosses into root authority on the target.
6. Explicit export crosses secret material from the target into local files.

## In-scope threats and mitigations

### Prompt injection asks for arbitrary execution

Tools accept only stable identifiers resolved against a validated allowlist.
Subprocesses use argv arrays. The remote command selects one fixed helper action
and passes validated configuration as base64 JSON; it does not evaluate
model-authored shell text.

### Model applies an unreviewed or stale change

Mutation defaults off. Planning persists a short-lived SHA-256-bound record with
the exact target configuration, remote deployment id, and a fingerprint of all
managed files plus service activity. Apply requires the exact confirmation,
re-reads that baseline, rejects any drift, and consumes a successful plan.

### Man-in-the-middle SSH attack

SSH uses `StrictHostKeyChecking=yes`, one explicit non-empty known-hosts file,
public-key-only authentication, no local command, and no forwarding. The operator
must authenticate the pinned key out of band.

### Partial deployment cuts off service

The helper validates generated WireGuard and Xray configuration before install,
uses same-filesystem replacement, records managed-file and service state, and
restores the backup on a failed transaction. An exact backup id supports later
rollback. An independent console remains necessary because routing, kernel,
provider, or power failures are outside the transaction.

### Secret disclosure through the model or logs

Keys are generated on the target. Normal tool values contain only ids, booleans,
counts, timestamps, paths, sizes, and digests. No debug tracing is enabled.
Secret export streams stdout directly into new `0600` files with an output cap;
the contents are not buffered into the tool result.

### Path traversal or destructive cleanup

Target ids, client ids, interfaces, services, hosts, ports, and paths are
validated both locally and remotely. The remote state directory must end in
`/dsh-vpn-ops`; recursive cleanup is confined below its `clients` child. Plan
ids and backup ids have fixed shapes and cannot become path components chosen by
the model.

### Package-install supply-chain execution

The published package includes built ESM, declarations, and the helper. It has
no install, prepare, or prepack lifecycle hook. Runtime dependencies and DSH
peers are exact. CI uses a frozen lockfile. The plugin never downloads or
installs Xray or operating-system packages.

### Concurrent operations

The remote helper uses a per-target lock. Local plans are immutable files.
Apply compares the remote baseline immediately before mutation. A failed export
removes files written by that export attempt.

## Residual risks

- An attacker controlling the DSH process, package, local credential, target
  root account, or Xray binary can bypass these boundaries.
- A root-equivalent SSH key can be used outside this plugin unless the operator
  adds independent SSH restrictions.
- REALITY forwards failed authentication traffic to its configured target and
  can be abused after scanning. Target selection, fronting filters, and rate
  policy are operator responsibilities.
- Service-local checks cannot prove reachability through every provider
  firewall, NAT, DNS path, or client network.
- WireGuard and VLESS credentials are long-lived until the operator rotates or
  deletes remote state. Rotation is not automated in `0.1.0`.
- Rollback restores managed files and service state, not external systems.

## Safe deployment recommendation

Use a dedicated test server and SSH credential, verify the host key out of band,
keep a provider console open, plan with mutation disabled, review the generated
change set, enable mutation only for the approved call, test both lines from a
separate network, export one client at a time, and disable both gates afterward.
