/**
 * Safety-gated WireGuard and VLESS Reality operations for DeepSeek Harness.
 *
 * The plugin exposes only allowlisted target ids. Mutations require a fresh,
 * persisted plan, an exact confirmation string, and an operator-owned config
 * flag. No tool accepts an arbitrary host or shell command.
 * @module dsh-vpn-ops
 */
import type { Context } from '@deepseek-ai/cordis';
import type { VpnOperationsApi } from './operations.js';
import type { Config as PluginConfig } from './types.js';
export type { ClientConfig, ResolvedClientConfig, ResolvedConfig, ResolvedTargetConfig, TargetConfig, } from './types.js';
export type { Config as DshVpnOpsConfig } from './types.js';
export { VpnOperations } from './operations.js';
export { resolveConfig } from './config.js';
/** Cordis plugin name used in loader diagnostics. */
export declare const name = "vpn-ops";
/** The tool registry is the plugin's sole DSH service dependency. */
export declare const inject: string[];
/** Schemastery configuration used by DSH Loader. */
export declare const Config: import("@deepseek-ai/schemastery").default<PluginConfig>;
/** DSH lifecycle entry point. All registrations unwind automatically with the plugin fiber. */
export declare function apply(ctx: Context, config: PluginConfig): void;
/** Register model-facing tools over an injectable operations service. Exported for runtime-path verification. */
export declare function registerTools(ctx: Context, operations: VpnOperationsApi): void;
