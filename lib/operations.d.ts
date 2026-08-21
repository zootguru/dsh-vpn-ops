import { PlanStore } from './plan-store.js';
import type { RemoteTransport } from './ssh.js';
import type { ResolvedConfig } from './types.js';
export interface TargetSummary {
    readonly id: string;
    readonly mutationEnabled: boolean;
    readonly secretExportEnabled: boolean;
    readonly clientIds: readonly string[];
}
export interface PreflightResult {
    readonly targetId: string;
    readonly ready: boolean;
    readonly osId: string;
    readonly architecture: string;
    readonly effectiveUid: number;
    readonly missingCommands: readonly string[];
    readonly localPolicy: readonly string[];
}
export interface StatusResult {
    readonly targetId: string;
    readonly deploymentId: string;
    readonly backupId: string;
    readonly stateFingerprint: string;
    readonly wireguardActive: boolean;
    readonly xrayActive: boolean;
    readonly wireguardPeers: number;
    readonly latestHandshakeEpoch: number;
    readonly wireguardPortListening: boolean;
    readonly vlessPortListening: boolean;
}
export interface PlanResult {
    readonly targetId: string;
    readonly planId: string;
    readonly expiresAt: string;
    readonly baselineDeploymentId: string;
    readonly baselineStateFingerprint: string;
    readonly changes: readonly string[];
    readonly mutationEnabled: boolean;
    readonly confirmation: string;
}
export interface VerifyResult {
    readonly targetId: string;
    readonly ok: boolean;
    readonly wireguardConfigValid: boolean;
    readonly xrayConfigValid: boolean;
    readonly servicesActive: boolean;
    readonly portsListening: boolean;
    readonly handshakesSeen: boolean;
    readonly details: readonly string[];
}
export interface ApplyResult {
    readonly targetId: string;
    readonly deploymentId: string;
    readonly backupId: string;
    readonly changed: boolean;
    readonly remoteClientDirectory: string;
    readonly verification: VerifyResult;
}
export interface RollbackResult {
    readonly targetId: string;
    readonly backupId: string;
    readonly restored: boolean;
    readonly verification: VerifyResult;
}
export interface SecretExportResult {
    readonly targetId: string;
    readonly clientId: string;
    readonly deploymentId: string;
    readonly files: readonly string[];
    readonly sha256: readonly string[];
    readonly bytes: readonly number[];
}
/** Narrow seam consumed by tool registration and replaced by runtime-path tests. */
export interface VpnOperationsApi {
    targets(): readonly TargetSummary[];
    preflight(targetId: string, signal: AbortSignal): Promise<PreflightResult>;
    status(targetId: string, signal: AbortSignal): Promise<StatusResult>;
    plan(targetId: string, signal: AbortSignal): Promise<PlanResult>;
    apply(targetId: string, planId: string, confirmation: string, signal: AbortSignal): Promise<ApplyResult>;
    verify(targetId: string, signal: AbortSignal): Promise<VerifyResult>;
    rollback(targetId: string, backupId: string, confirmation: string, signal: AbortSignal): Promise<RollbackResult>;
    exportClient(targetId: string, clientId: string, confirmation: string, signal: AbortSignal): Promise<SecretExportResult>;
}
/** Safety-gated application service behind every model-facing tool. */
export declare class VpnOperations implements VpnOperationsApi {
    private readonly config;
    private readonly transport;
    private readonly plans;
    constructor(config: ResolvedConfig, transport?: RemoteTransport, plans?: PlanStore);
    targets(): readonly TargetSummary[];
    preflight(targetId: string, signal: AbortSignal): Promise<PreflightResult>;
    status(targetId: string, signal: AbortSignal): Promise<StatusResult>;
    plan(targetId: string, signal: AbortSignal): Promise<PlanResult>;
    apply(targetId: string, planId: string, confirmation: string, signal: AbortSignal): Promise<ApplyResult>;
    verify(targetId: string, signal: AbortSignal): Promise<VerifyResult>;
    rollback(targetId: string, backupId: string, confirmation: string, signal: AbortSignal): Promise<RollbackResult>;
    exportClient(targetId: string, clientId: string, confirmation: string, signal: AbortSignal): Promise<SecretExportResult>;
}
