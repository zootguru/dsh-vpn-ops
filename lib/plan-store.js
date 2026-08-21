import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, sha256 } from './canonical.js';
/** Local non-secret plan persistence. A plan must exist and remain fresh before apply. */
export class PlanStore {
    config;
    now;
    constructor(config, now = () => new Date()) {
        this.config = config;
        this.now = now;
    }
    async create(target, baselineDeploymentId, baselineStateFingerprint) {
        const created = this.now();
        const payload = {
            schemaVersion: 1,
            targetId: target.id,
            createdAt: created.toISOString(),
            expiresAt: new Date(created.getTime() + this.config.planTtlSeconds * 1_000).toISOString(),
            configDigest: targetDigest(target),
            baselineDeploymentId,
            baselineStateFingerprint,
        };
        const planId = sha256(canonicalJson(payload));
        const record = { ...payload, planId };
        const directory = this.pendingDirectory();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, `${planId}.json`), `${JSON.stringify(record, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        return record;
    }
    async readUsable(planId, target) {
        assertPlanId(planId);
        const raw = await readFile(join(this.pendingDirectory(), `${planId}.json`), 'utf8');
        const candidate = JSON.parse(raw);
        if (candidate.schemaVersion !== 1 || candidate.planId !== planId || candidate.targetId !== target.id) {
            throw new Error('plan record does not match the requested target and schema');
        }
        if (candidate.configDigest !== targetDigest(target))
            throw new Error('target configuration changed after planning; create a new plan');
        if (typeof candidate.expiresAt !== 'string' || Date.parse(candidate.expiresAt) <= this.now().getTime()) {
            throw new Error('plan expired; create a new plan');
        }
        if (typeof candidate.createdAt !== 'string'
            || typeof candidate.baselineDeploymentId !== 'string'
            || typeof candidate.baselineStateFingerprint !== 'string') {
            throw new Error('plan record is incomplete');
        }
        return candidate;
    }
    async consume(planId) {
        assertPlanId(planId);
        const consumed = join(this.config.stateDirectory, 'plans', 'consumed');
        await mkdir(consumed, { recursive: true, mode: 0o700 });
        await rename(join(this.pendingDirectory(), `${planId}.json`), join(consumed, `${planId}.json`));
    }
    pendingDirectory() {
        return join(this.config.stateDirectory, 'plans', 'pending');
    }
}
/** Digest only non-secret deployment and SSH policy, never file contents. */
export function targetDigest(target) {
    return sha256(canonicalJson(target));
}
function assertPlanId(planId) {
    if (!/^[a-f0-9]{64}$/.test(planId))
        throw new Error('planId must be a 64-character SHA-256 value');
}
