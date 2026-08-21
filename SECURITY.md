# Security Policy

## Supported versions

Only the latest tagged release receives security fixes. The initial supported
line is `0.1.x`, paired with the exact DSH version documented in the release.

## Report a vulnerability

Do not open a public issue containing credentials, private keys, client
profiles, server addresses that must remain private, or a working exploit.

Use GitHub's private vulnerability reporting for
`zootguru/dsh-vpn-ops`. Include the affected version, DSH version, target OS,
impact, reproduction steps with synthetic data, and any proposed mitigation.

Expect acknowledgement within seven days. No bounty or response SLA is
promised. Coordinated disclosure is preferred.

## Security boundaries

This plugin reduces model-facing authority; it does not make a compromised DSH
host, SSH key, root account, server, Xray binary, npm registry, or GitHub account
trustworthy. Operators remain responsible for:

- authenticating the SSH host key through an independent channel;
- protecting the dedicated root-equivalent SSH credential;
- sourcing and updating WireGuard, Xray, and operating-system packages;
- reviewing plans and explicit confirmation strings;
- restricting local secret-export files and deleting them after transfer;
- maintaining an independent recovery channel and off-host backup;
- testing connectivity from an external network.

The detailed assets, trust boundaries, misuse cases, mitigations, and residual
risks are documented in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
