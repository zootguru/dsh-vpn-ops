/**
 * Safety-gated WireGuard and VLESS Reality operations for DeepSeek Harness.
 *
 * The plugin exposes only allowlisted target ids. Mutations require a fresh,
 * persisted plan, an exact confirmation string, and an operator-owned config
 * flag. No tool accepts an arbitrary host or shell command.
 * @module dsh-vpn-ops
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Config as ConfigSchema, resolveConfig } from './config.js';
import { VpnOperations } from './operations.js';
export { VpnOperations } from './operations.js';
export { resolveConfig } from './config.js';
/** Cordis plugin name used in loader diagnostics. */
export const name = 'vpn-ops';
/** The tool registry is the plugin's sole DSH service dependency. */
export const inject = ['tools'];
/** Schemastery configuration used by DSH Loader. */
export const Config = ConfigSchema;
const VERIFY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        targetId: { type: 'string', required: true },
        ok: { type: 'boolean', required: true },
        wireguardConfigValid: { type: 'boolean', required: true },
        xrayConfigValid: { type: 'boolean', required: true },
        servicesActive: { type: 'boolean', required: true },
        portsListening: { type: 'boolean', required: true },
        handshakesSeen: { type: 'boolean', required: true },
        details: { type: 'array', required: true, items: { type: 'string' } },
    },
};
/** DSH lifecycle entry point. All registrations unwind automatically with the plugin fiber. */
export function apply(ctx, config) {
    registerTools(ctx, new VpnOperations(resolveConfig(config)));
}
/** Register model-facing tools over an injectable operations service. Exported for runtime-path verification. */
export function registerTools(ctx, operations) {
    ctx.tools.register(defineTool({
        name: 'vpn_targets',
        description: 'List configured VPN target and client ids plus the operator-owned mutation gates. Returns no SSH host or secret.',
        parameters: {},
        output: {
            schema: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        mutationEnabled: { type: 'boolean', required: true },
                        secretExportEnabled: { type: 'boolean', required: true },
                        clientIds: { type: 'array', required: true, items: { type: 'string' } },
                    },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        isConcurrencySafe: () => true,
        execute: async () => operations.targets().map(target => ({ ...target, clientIds: [...target.clientIds] })),
        presentCall: () => ({ card: 'generic', title: 'List VPN targets', kind: 'read' }),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_preflight',
        description: 'Check one allowlisted target for supported OS, root authority, required commands, and strict local SSH policy. Makes no changes.',
        parameters: targetParameters(),
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    targetId: { type: 'string', required: true },
                    ready: { type: 'boolean', required: true },
                    osId: { type: 'string', required: true },
                    architecture: { type: 'string', required: true },
                    effectiveUid: { type: 'integer', required: true },
                    missingCommands: { type: 'array', required: true, items: { type: 'string' } },
                    localPolicy: { type: 'array', required: true, items: { type: 'string' } },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        isConcurrencySafe: () => true,
        execute: async (args, exec) => {
            const result = await operations.preflight(args.targetId, exec.signal);
            return { ...result, missingCommands: [...result.missingCommands], localPolicy: [...result.localPolicy] };
        },
        presentCall: args => targetCard('Preflight VPN target', 'read', args.targetId),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_status',
        description: 'Read service, listener, peer, handshake, deployment, and backup status from one allowlisted target. Makes no changes.',
        parameters: targetParameters(),
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    targetId: { type: 'string', required: true },
                    deploymentId: { type: 'string', required: true },
                    backupId: { type: 'string', required: true },
                    stateFingerprint: { type: 'string', required: true },
                    wireguardActive: { type: 'boolean', required: true },
                    xrayActive: { type: 'boolean', required: true },
                    wireguardPeers: { type: 'integer', required: true },
                    latestHandshakeEpoch: { type: 'integer', required: true },
                    wireguardPortListening: { type: 'boolean', required: true },
                    vlessPortListening: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        isConcurrencySafe: () => true,
        execute: (args, exec) => operations.status(args.targetId, exec.signal),
        presentCall: args => targetCard('Read VPN status', 'read', args.targetId),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_plan',
        description: 'Preflight an allowlisted target and persist a short-lived non-secret plan bound to its current deployment and exact configuration. Makes no remote changes.',
        parameters: targetParameters(),
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    targetId: { type: 'string', required: true },
                    planId: { type: 'string', required: true },
                    expiresAt: { type: 'string', required: true },
                    baselineDeploymentId: { type: 'string', required: true },
                    baselineStateFingerprint: { type: 'string', required: true },
                    changes: { type: 'array', required: true, items: { type: 'string' } },
                    mutationEnabled: { type: 'boolean', required: true },
                    confirmation: { type: 'string', required: true },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        execute: async (args, exec) => {
            const result = await operations.plan(args.targetId, exec.signal);
            return { ...result, changes: [...result.changes] };
        },
        presentCall: args => targetCard('Plan VPN deployment', 'search', args.targetId),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_apply',
        description: 'Apply one fresh VPN plan. Requires allowMutations=true and the exact confirmation returned by vpn_plan; rejects stale or reused plans.',
        parameters: {
            targetId: targetParameter(),
            planId: { type: 'string', required: true, description: 'Exact 64-character plan id returned by vpn_plan.' },
            confirmation: { type: 'string', required: true, description: 'Exact APPLY confirmation string returned by vpn_plan.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    targetId: { type: 'string', required: true },
                    deploymentId: { type: 'string', required: true },
                    backupId: { type: 'string', required: true },
                    changed: { type: 'boolean', required: true },
                    remoteClientDirectory: { type: 'string', required: true },
                    verification: { ...VERIFY_SCHEMA, required: true },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        execute: async (args, exec) => {
            const result = await operations.apply(args.targetId, args.planId, args.confirmation, exec.signal);
            return { ...result, verification: { ...result.verification, details: [...result.verification.details] } };
        },
        presentCall: args => targetCard('Apply VPN deployment', 'execute', args.targetId),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_verify',
        description: 'Validate managed WireGuard and Xray configuration, services, listeners, and handshake evidence on one allowlisted target. Makes no changes.',
        parameters: targetParameters(),
        output: {
            schema: VERIFY_SCHEMA,
            render: (_args, value) => jsonContent(value),
        },
        isConcurrencySafe: () => true,
        execute: async (args, exec) => {
            const result = await operations.verify(args.targetId, exec.signal);
            return { ...result, details: [...result.details] };
        },
        presentCall: args => targetCard('Verify VPN deployment', 'read', args.targetId),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_rollback',
        description: 'Restore an exact backup created by vpn_apply. Requires allowMutations=true and an exact ROLLBACK confirmation string.',
        parameters: {
            targetId: targetParameter(),
            backupId: { type: 'string', required: true, description: 'Exact backup id returned by vpn_apply or vpn_status.' },
            confirmation: { type: 'string', required: true, description: 'Exact string ROLLBACK <targetId> <backupId> supplied by the operator.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    targetId: { type: 'string', required: true },
                    backupId: { type: 'string', required: true },
                    restored: { type: 'boolean', required: true },
                    verification: { ...VERIFY_SCHEMA, required: true },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        execute: async (args, exec) => {
            const result = await operations.rollback(args.targetId, args.backupId, args.confirmation, exec.signal);
            return { ...result, verification: { ...result.verification, details: [...result.verification.details] } };
        },
        presentCall: args => targetCard('Rollback VPN deployment', 'execute', args.targetId),
    }));
    ctx.tools.register(defineTool({
        name: 'vpn_export_client',
        description: 'Export one configured client to operator-local 0600 files without returning secret contents. Requires allowSecretExport=true and an exact EXPORT confirmation.',
        parameters: {
            targetId: targetParameter(),
            clientId: { type: 'string', required: true, description: 'Configured client id from vpn_targets.' },
            confirmation: { type: 'string', required: true, description: 'Exact string EXPORT <targetId> <clientId> supplied by the operator.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    targetId: { type: 'string', required: true },
                    clientId: { type: 'string', required: true },
                    deploymentId: { type: 'string', required: true },
                    files: { type: 'array', required: true, items: { type: 'string' } },
                    sha256: { type: 'array', required: true, items: { type: 'string' } },
                    bytes: { type: 'array', required: true, items: { type: 'integer' } },
                },
            },
            render: (_args, value) => jsonContent(value),
        },
        execute: async (args, exec) => {
            const result = await operations.exportClient(args.targetId, args.clientId, args.confirmation, exec.signal);
            return { ...result, files: [...result.files], sha256: [...result.sha256], bytes: [...result.bytes] };
        },
        presentCall: args => targetCard('Export VPN client', 'execute', args.targetId),
    }));
}
function targetParameter() {
    return { type: 'string', required: true, description: 'Allowlisted target id from vpn_targets.' };
}
function targetParameters() {
    return { targetId: targetParameter() };
}
function jsonContent(value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
function targetCard(title, kind, targetId) {
    return { card: 'generic', title: `${title}: ${targetId}`, kind, rawInput: targetId };
}
