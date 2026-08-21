import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalJson, sha256 } from './canonical.js'
import type { PlanRecord, ResolvedConfig, ResolvedTargetConfig } from './types.js'

/** Local non-secret plan persistence. A plan must exist and remain fresh before apply. */
export class PlanStore {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    target: ResolvedTargetConfig,
    baselineDeploymentId: string,
    baselineStateFingerprint: string,
  ): Promise<PlanRecord> {
    const created = this.now()
    const payload = {
      schemaVersion: 1 as const,
      targetId: target.id,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + this.config.planTtlSeconds * 1_000).toISOString(),
      configDigest: targetDigest(target),
      baselineDeploymentId,
      baselineStateFingerprint,
    }
    const planId = sha256(canonicalJson(payload))
    const record: PlanRecord = { ...payload, planId }
    const directory = this.pendingDirectory()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(join(directory, `${planId}.json`), `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    return record
  }

  async readUsable(planId: string, target: ResolvedTargetConfig): Promise<PlanRecord> {
    assertPlanId(planId)
    const raw = await readFile(join(this.pendingDirectory(), `${planId}.json`), 'utf8')
    const candidate = JSON.parse(raw) as Partial<PlanRecord>
    if (candidate.schemaVersion !== 1 || candidate.planId !== planId || candidate.targetId !== target.id) {
      throw new Error('plan record does not match the requested target and schema')
    }
    if (candidate.configDigest !== targetDigest(target)) throw new Error('target configuration changed after planning; create a new plan')
    if (typeof candidate.expiresAt !== 'string' || Date.parse(candidate.expiresAt) <= this.now().getTime()) {
      throw new Error('plan expired; create a new plan')
    }
    if (
      typeof candidate.createdAt !== 'string'
      || typeof candidate.baselineDeploymentId !== 'string'
      || typeof candidate.baselineStateFingerprint !== 'string'
    ) {
      throw new Error('plan record is incomplete')
    }
    return candidate as PlanRecord
  }

  async consume(planId: string): Promise<void> {
    assertPlanId(planId)
    const consumed = join(this.config.stateDirectory, 'plans', 'consumed')
    await mkdir(consumed, { recursive: true, mode: 0o700 })
    await rename(join(this.pendingDirectory(), `${planId}.json`), join(consumed, `${planId}.json`))
  }

  private pendingDirectory(): string {
    return join(this.config.stateDirectory, 'plans', 'pending')
  }
}

/** Digest only non-secret deployment and SSH policy, never file contents. */
export function targetDigest(target: ResolvedTargetConfig): string {
  return sha256(canonicalJson(target))
}

function assertPlanId(planId: string): void {
  if (!/^[a-f0-9]{64}$/.test(planId)) throw new Error('planId must be a 64-character SHA-256 value')
}
