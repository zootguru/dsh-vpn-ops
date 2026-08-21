import type { ProcessResult } from './types.js';
export interface RunOptions {
    readonly input?: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
}
export interface FileResult {
    readonly bytes: number;
    readonly sha256: string;
    readonly stderr: string;
    readonly truncated: boolean;
}
/** Subprocess seam used by SSH. Exposed so verification tests can replace transport without a server. */
export interface CommandRunner {
    run(command: string, args: readonly string[], options: RunOptions): Promise<ProcessResult>;
    runToFile(command: string, args: readonly string[], destination: string, options: RunOptions): Promise<FileResult>;
}
/** Spawn argv directly, bound time and output, and never invoke a local shell. */
export declare class LocalCommandRunner implements CommandRunner {
    run(command: string, args: readonly string[], options: RunOptions): Promise<ProcessResult>;
    runToFile(command: string, args: readonly string[], destination: string, options: RunOptions): Promise<FileResult>;
}
/** Render a contained process failure without leaking input or environment. */
export declare function processFailure(command: string, exitCode: number, stderr: string, truncated: boolean): Error;
