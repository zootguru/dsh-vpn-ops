import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getTarget } from './config.js';
import { PlanStore } from './plan-store.js';
import { SshTransport } from './ssh.js';
/** Safety-gated application service behind every model-facing tool. */
export class VpnOperations {
    config;
    transport;
    plans;
    constructor(config, transport, plans) {
        this.config = config;
        this.transport = transport ?? new SshTransport(config);
        this.plans = plans ?? new PlanStore(config);
    }
    targets() {
        return this.config.targets.map(target => ({
            id: target.id,
            mutationEnabled: this.config.allowMutations,
            secretExportEnabled: this.config.allowSecretExport,
            clientIds: target.clients.map(client => client.id),
        }));
    }
    async preflight(targetId, signal) {
        const target = getTarget(this.config, targetId);
        const remote = await this.transport.invoke(target, 'preflight', deploymentConfig(target, ''), signal);
        const missingCommands = csv(remote.missing_commands);
        const effectiveUid = integer(remote.effective_uid, 'effective_uid');
        const ready = remote.os_supported === 'true' && effectiveUid === 0 && missingCommands.length === 0;
        return {
            targetId,
            ready,
            osId: required(remote, 'os_id'),
            architecture: required(remote, 'architecture'),
            effectiveUid,
            missingCommands,
            localPolicy: [
                'strict-host-key-checking',
                'public-key-only',
                'fixed-remote-helper',
                this.config.allowMutations ? 'mutations-enabled' : 'mutations-disabled',
            ],
        };
    }
    async status(targetId, signal) {
        const target = getTarget(this.config, targetId);
        const remote = await this.transport.invoke(target, 'status', deploymentConfig(target, ''), signal);
        return statusFromRemote(targetId, remote);
    }
    async plan(targetId, signal) {
        const target = getTarget(this.config, targetId);
        const preflight = await this.preflight(targetId, signal);
        if (!preflight.ready) {
            const missing = preflight.missingCommands.length > 0 ? `; missing: ${preflight.missingCommands.join(', ')}` : '';
            throw new Error(`target ${targetId} failed preflight (os=${preflight.osId}, uid=${preflight.effectiveUid})${missing}`);
        }
        const status = await this.status(targetId, signal);
        const record = await this.plans.create(target, status.deploymentId, status.stateFingerprint);
        return {
            targetId,
            planId: record.planId,
            expiresAt: record.expiresAt,
            baselineDeploymentId: record.baselineDeploymentId,
            baselineStateFingerprint: record.baselineStateFingerprint,
            changes: changeSet(target),
            mutationEnabled: this.config.allowMutations,
            confirmation: `APPLY ${targetId} ${record.planId}`,
        };
    }
    async apply(targetId, planId, confirmation, signal) {
        assertMutationsEnabled(this.config);
        const target = getTarget(this.config, targetId);
        if (confirmation !== `APPLY ${targetId} ${planId}`)
            throw new Error('confirmation does not exactly match the plan');
        const plan = await this.plans.readUsable(planId, target);
        const current = await this.status(targetId, signal);
        if (current.deploymentId !== plan.baselineDeploymentId
            || current.stateFingerprint !== plan.baselineStateFingerprint) {
            throw new Error('remote deployment changed after planning; create a new plan');
        }
        const remote = await this.transport.invoke(target, 'apply', deploymentConfig(target, planId), signal);
        const deploymentId = required(remote, 'deployment_id');
        if (deploymentId !== planId)
            throw new Error('remote helper did not commit the requested plan');
        const backupId = required(remote, 'backup_id');
        await this.plans.consume(planId);
        const verification = await this.verify(targetId, signal);
        return {
            targetId,
            deploymentId,
            backupId,
            changed: boolean(remote.changed, 'changed'),
            remoteClientDirectory: `${target.remoteStateDirectory}/clients`,
            verification,
        };
    }
    async verify(targetId, signal) {
        const target = getTarget(this.config, targetId);
        const remote = await this.transport.invoke(target, 'verify', deploymentConfig(target, ''), signal);
        const wireguardConfigValid = boolean(remote.wireguard_config_valid, 'wireguard_config_valid');
        const xrayConfigValid = boolean(remote.xray_config_valid, 'xray_config_valid');
        const servicesActive = boolean(remote.services_active, 'services_active');
        const portsListening = boolean(remote.ports_listening, 'ports_listening');
        const handshakesSeen = boolean(remote.handshakes_seen, 'handshakes_seen');
        return {
            targetId,
            ok: wireguardConfigValid && xrayConfigValid && servicesActive && portsListening,
            wireguardConfigValid,
            xrayConfigValid,
            servicesActive,
            portsListening,
            handshakesSeen,
            details: csv(remote.details),
        };
    }
    async rollback(targetId, backupId, confirmation, signal) {
        assertMutationsEnabled(this.config);
        const target = getTarget(this.config, targetId);
        if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(backupId))
            throw new Error('backupId has an invalid shape');
        if (confirmation !== `ROLLBACK ${targetId} ${backupId}`)
            throw new Error('confirmation does not exactly match the rollback');
        const remote = await this.transport.invoke(target, 'rollback', deploymentConfig(target, ''), signal, { DSH_VPN_OPS_BACKUP_ID: backupId });
        if (required(remote, 'backup_id') !== backupId)
            throw new Error('remote helper restored an unexpected backup');
        const verification = await this.verify(targetId, signal);
        return { targetId, backupId, restored: boolean(remote.restored, 'restored'), verification };
    }
    async exportClient(targetId, clientId, confirmation, signal) {
        if (!this.config.allowSecretExport)
            throw new Error('secret export is disabled by plugin configuration');
        const target = getTarget(this.config, targetId);
        if (!target.clients.some(client => client.id === clientId))
            throw new Error(`unknown clientId "${clientId}" for target ${targetId}`);
        if (confirmation !== `EXPORT ${targetId} ${clientId}`)
            throw new Error('confirmation does not exactly match the secret export');
        const status = await this.status(targetId, signal);
        if (status.deploymentId === '')
            throw new Error('target has no managed deployment to export');
        const directory = join(this.config.stateDirectory, 'exports', targetId, status.deploymentId, clientId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const wireguardPath = join(directory, 'wireguard.conf');
        const vlessPath = join(directory, 'vless.txt');
        const deployment = deploymentConfig(target, status.deploymentId);
        const extra = { DSH_VPN_OPS_CLIENT_ID: clientId };
        const written = [];
        try {
            const wg = await this.transport.exportToFile(target, 'export-wireguard', deployment, wireguardPath, signal, extra);
            written.push(wireguardPath);
            const vless = await this.transport.exportToFile(target, 'export-vless', deployment, vlessPath, signal, extra);
            written.push(vlessPath);
            return exportResult(targetId, clientId, status.deploymentId, wireguardPath, vlessPath, wg, vless);
        }
        catch (error) {
            await Promise.all(written.map(path => rm(path, { force: true })));
            throw error;
        }
    }
}
function deploymentConfig(target, planId) {
    return {
        schemaVersion: 1,
        targetId: target.id,
        planId,
        publicEndpoint: target.publicEndpoint,
        publicInterface: target.publicInterface,
        remoteStateDirectory: target.remoteStateDirectory,
        wireguardInterface: target.wireguardInterface,
        wireguardAddress: target.wireguardAddress,
        wireguardListenPort: target.wireguardListenPort,
        wireguardConfigPath: target.wireguardConfigPath,
        wireguardService: target.wireguardService,
        clientDns: target.clientDns,
        clientMtu: target.clientMtu,
        vlessListenAddress: target.vlessListenAddress,
        vlessPort: target.vlessPort,
        realityServerName: target.realityServerName,
        realityDestination: target.realityDestination,
        xrayBinary: target.xrayBinary,
        xrayConfigPath: target.xrayConfigPath,
        xrayService: target.xrayService,
        sysctlConfigPath: target.sysctlConfigPath,
        clients: target.clients,
    };
}
function changeSet(target) {
    return [
        `atomically replace ${target.wireguardConfigPath}`,
        `atomically replace ${target.xrayConfigPath}`,
        `enable IPv4 forwarding through ${target.sysctlConfigPath}`,
        `restart and enable ${target.wireguardService} and ${target.xrayService}`,
        `maintain ${target.clients.length} encrypted client identities under ${target.remoteStateDirectory}`,
        `create a rollback snapshot before the first write`,
    ];
}
function statusFromRemote(targetId, remote) {
    return {
        targetId,
        deploymentId: remote.deployment_id ?? '',
        backupId: remote.backup_id ?? '',
        stateFingerprint: required(remote, 'state_fingerprint'),
        wireguardActive: boolean(remote.wireguard_active, 'wireguard_active'),
        xrayActive: boolean(remote.xray_active, 'xray_active'),
        wireguardPeers: integer(remote.wireguard_peers, 'wireguard_peers'),
        latestHandshakeEpoch: integer(remote.latest_handshake_epoch, 'latest_handshake_epoch'),
        wireguardPortListening: boolean(remote.wireguard_port_listening, 'wireguard_port_listening'),
        vlessPortListening: boolean(remote.vless_port_listening, 'vless_port_listening'),
    };
}
function exportResult(targetId, clientId, deploymentId, wireguardPath, vlessPath, wireguard, vless) {
    return {
        targetId,
        clientId,
        deploymentId,
        files: [wireguardPath, vlessPath],
        sha256: [wireguard.sha256, vless.sha256],
        bytes: [wireguard.bytes, vless.bytes],
    };
}
function assertMutationsEnabled(config) {
    if (!config.allowMutations)
        throw new Error('remote mutations are disabled by plugin configuration');
}
function required(values, key) {
    const value = values[key];
    if (value === undefined)
        throw new Error(`remote helper omitted ${key}`);
    return value;
}
function boolean(value, field) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    throw new Error(`remote helper returned invalid boolean ${field}`);
}
function integer(value, field) {
    if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value))
        throw new Error(`remote helper returned invalid integer ${field}`);
    const result = Number(value);
    if (!Number.isSafeInteger(result))
        throw new Error(`remote helper returned oversized integer ${field}`);
    return result;
}
function csv(value) {
    return value === undefined || value === '' ? [] : value.split(',').filter(Boolean);
}
