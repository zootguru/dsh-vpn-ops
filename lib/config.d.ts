import z from '@deepseek-ai/schemastery';
import type { Config as PluginConfig, ResolvedConfig, ResolvedTargetConfig } from './types.js';
/** Schemastery configuration consumed by the DSH Loader. */
export declare const Config: z<PluginConfig>;
/** Apply schema defaults defensively and reject cross-field or filesystem-shaped hazards. */
export declare function resolveConfig(config: PluginConfig): ResolvedConfig;
/** Resolve an allowlisted target by its exact stable identifier. */
export declare function getTarget(config: ResolvedConfig, targetId: string): ResolvedTargetConfig;
