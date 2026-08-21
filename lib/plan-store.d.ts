import type { PlanRecord, ResolvedConfig, ResolvedTargetConfig } from './types.js';
/** Local non-secret plan persistence. A plan must exist and remain fresh before apply. */
export declare class PlanStore {
    private readonly config;
    private readonly now;
    constructor(config: ResolvedConfig, now?: () => Date);
    create(target: ResolvedTargetConfig, baselineDeploymentId: string, baselineStateFingerprint: string): Promise<PlanRecord>;
    readUsable(planId: string, target: ResolvedTargetConfig): Promise<PlanRecord>;
    consume(planId: string): Promise<void>;
    private pendingDirectory;
}
/** Digest only non-secret deployment and SSH policy, never file contents. */
export declare function targetDigest(target: ResolvedTargetConfig): string;
