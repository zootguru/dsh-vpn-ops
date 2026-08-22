# Verification evidence

## Compatibility target

- Plugin: `dsh-vpn-ops@0.1.0`
- DSH: `0.1.1-rc.2`
- DSH source commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Node: `22.19.x` and `24.x`
- pnpm: `11.19.0`

## Repository gates

Run from a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm test:coverage
pnpm verify
git diff --exit-code
```

`pnpm verify` performs a clean build, strict typecheck, all tests, POSIX shell
syntax validation, package build, `publint`, and package-evidence inspection.
Coverage thresholds are 80% for statements, branches, functions, and lines.

## Packed-install gate

```sh
pnpm pack --pack-destination ./artifacts
tar -tzf ./artifacts/dsh-vpn-ops-0.1.0.tgz
dsh plugin --profile vpn-ops-clean add ./artifacts/dsh-vpn-ops-0.1.0.tgz
dsh --profile vpn-ops-clean --dump-config
```

Evidence required for “runtime verified”:

1. The tarball contains built `lib/`, `cordis.patch.yml`, and the fixed helper.
2. Installation runs no package lifecycle hook.
3. The composed config contains one enabled `vpn-ops` row.
4. A clean profile boots without a configured target.
5. `vpn_targets` returns an empty array.
6. Disposing the profile unregisters all eight tool definitions.

## Staging-target acceptance gate

Do not run this section against production first.

1. Configure one disposable Debian/Ubuntu target and two synthetic clients.
2. Keep mutation and export disabled; run targets, preflight, status, and plan.
3. Verify the plan contains only the documented files and services.
4. Enable mutation, apply the exact plan, and require `verification.ok=true`.
5. Test WireGuard from an independent client network.
6. Test VLESS Reality from an independent client network.
7. Confirm the observed egress address belongs to the staging server.
8. Export one client, verify local mode `0600`, and confirm no secret appears in
   the DSH tool value or durable transcript.
9. Roll back the returned backup id and verify prior file and service state.
10. Disable both gates and destroy or rotate every staging credential.

## Release evidence

Each GitHub release should attach:

- `dsh-vpn-ops-<version>.tgz`;
- a SHA-256 checksum file;
- the CI run URL;
- the DSH version and source commit;
- packed-install results;
- staging acceptance result or an explicit “not run” statement.

Never claim end-to-end network verification when only the clean-profile runtime
gate was run.

## Recorded result — 2026-08-21

- Final tarball SHA-256:
  `0d516394aaff65ff78bf28eeb8dda5b3b7c2aea0e741fdcaaf96b8183d1a8b0d`.
- Static/type/package gates: passed.
- Tests: 30 passed across seven test files.
- Coverage: statements 83.11%, branches 80.93%, functions 88.33%, lines 89.54%.
- `publint`: passed.
- POSIX shell syntax: passed.
- Clean profile: `vpn-ops-final`, created under an isolated DSH home.
- Packed install: passed with no lifecycle hook from `dsh-vpn-ops`.
- Composed config: contained the disabled-by-default `vpn-ops` row.
- Real DSH boot: loaded all eight `vpn_*` tools.
- Real tool dispatch: `vpn_targets` returned `[]` through the DSH execution
  pipeline.
- Shutdown: verifier disposed the root Cordis fiber and DSH exited with status 0.
- Staging-target WireGuard/VLESS acceptance: **not run**; no disposable server
  was placed in scope for this release build.
