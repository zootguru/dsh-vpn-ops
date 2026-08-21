# Release checklist

- [ ] Public repository identity, description, license, topics, and issue tracker are correct.
- [ ] `package.json` version, exports, engines, exact peers, `dsh.bundle`, and compatibility evidence are correct.
- [ ] No package lifecycle script exists.
- [ ] README documents target profile, install, configuration, permissions, limitations, verification, and uninstall.
- [ ] `pnpm install --frozen-lockfile`, coverage, verify, and clean-tree checks pass.
- [ ] Packed contents contain built code, declarations, helper, patch, license, README, and security policy only as intended.
- [ ] A clean DSH `0.1.1-rc.2` profile installs, dumps config, boots, exposes tools, and unloads cleanly.
- [ ] Failure paths for disabled mutation, stale plan, wrong confirmation, output bound, timeout, and rollback pass.
- [ ] Staging-target acceptance is recorded honestly.
- [ ] Tag is signed or created by the authenticated maintainer.
- [ ] GitHub release includes tarball, checksum, compatibility, and CI evidence.
- [ ] Repository topic `dsh-plugin` is present.
- [ ] Registry submission uses the public release URL and does not overstate runtime evidence.
