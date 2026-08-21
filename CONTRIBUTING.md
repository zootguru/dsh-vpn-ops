# Contributing

Security fixes, tests, documentation, and compatibility evidence are welcome.
Open an issue before a large behavior change. Never commit real server addresses,
host keys, SSH keys, WireGuard keys, VLESS UUIDs, REALITY keys, client profiles,
or provider credentials.

Required local gates:

```sh
pnpm install --frozen-lockfile
pnpm test:coverage
pnpm verify
```

Changes that add authority must update the threat model, failure-path tests,
README limitations, tool schema, and release evidence. New model-facing input
must remain an identifier or constrained value; arbitrary command execution is
out of scope.
