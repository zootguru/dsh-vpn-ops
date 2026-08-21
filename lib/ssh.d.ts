import type { CommandRunner, FileResult } from './process.js';
import type { RemoteDeploymentConfig, ResolvedConfig, ResolvedTargetConfig } from './types.js';
export type RemoteAction = 'preflight' | 'status' | 'verify' | 'apply' | 'rollback' | 'export-wireguard' | 'export-vless';
export interface RemoteTransport {
    invoke(target: ResolvedTargetConfig, action: RemoteAction, deployment: RemoteDeploymentConfig | undefined, signal: AbortSignal, extra?: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>>>;
    exportToFile(target: ResolvedTargetConfig, action: 'export-wireguard' | 'export-vless', deployment: RemoteDeploymentConfig, destination: string, signal: AbortSignal, extra: Readonly<Record<string, string>>): Promise<FileResult>;
}
/** Fixed-script SSH transport with strict host-key and public-key-only policy. */
export declare class SshTransport implements RemoteTransport {
    #private;
    private readonly config;
    private readonly runner;
    constructor(config: ResolvedConfig, runner?: CommandRunner);
    invoke(target: ResolvedTargetConfig, action: RemoteAction, deployment: RemoteDeploymentConfig | undefined, signal: AbortSignal, extra?: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>>>;
    exportToFile(target: ResolvedTargetConfig, action: 'export-wireguard' | 'export-vless', deployment: RemoteDeploymentConfig, destination: string, signal: AbortSignal, extra: Readonly<Record<string, string>>): Promise<FileResult>;
}
/** Parse the helper's deliberately tiny, newline-delimited response protocol. */
export declare function parseKeyValue(output: string): Readonly<Record<string, string>>;
