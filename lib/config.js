import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
const DEFAULT_STATE_DIRECTORY = join(homedir(), '.local', 'state', 'dsh-vpn-ops');
const clientSchema = z.object({
    id: z.string().required(),
    wireguardAddress: z.string().required(),
});
const targetSchema = z.object({
    id: z.string().required(),
    host: z.string().required(),
    user: z.string().default('root'),
    sshPort: z.number().step(1).min(1).max(65_535).default(22),
    identityFile: z.string().required(),
    knownHostsFile: z.string().required(),
    sudo: z.boolean().default(false),
    publicEndpoint: z.string().required(),
    publicInterface: z.string().required(),
    remoteStateDirectory: z.string().default('/var/lib/dsh-vpn-ops'),
    wireguardInterface: z.string().default('wg0'),
    wireguardAddress: z.string().default('10.66.66.1/24'),
    wireguardListenPort: z.number().step(1).min(1).max(65_535).default(51_820),
    wireguardConfigPath: z.string().default('/etc/wireguard/wg0.conf'),
    wireguardService: z.string().default('wg-quick@wg0'),
    clientDns: z.string().default('1.1.1.1'),
    clientMtu: z.number().step(1).min(1_280).max(1_500).default(1_420),
    vlessListenAddress: z.string().default('0.0.0.0'),
    vlessPort: z.number().step(1).min(1).max(65_535).default(443),
    realityServerName: z.string().required(),
    realityDestination: z.string().required(),
    xrayBinary: z.string().default('/usr/local/bin/xray'),
    xrayConfigPath: z.string().default('/usr/local/etc/xray/config.json'),
    xrayService: z.string().default('xray'),
    sysctlConfigPath: z.string().default('/etc/sysctl.d/99-dsh-vpn-ops.conf'),
    clients: z.array(clientSchema).required(),
});
/** Schemastery configuration consumed by the DSH Loader. */
export const Config = z.object({
    targets: z.array(targetSchema).default([]),
    stateDirectory: z.string().default(DEFAULT_STATE_DIRECTORY),
    connectTimeoutSeconds: z.number().step(1).min(1).max(120).default(10),
    commandTimeoutMs: z.number().step(1).min(1_000).max(900_000).default(120_000),
    maxOutputBytes: z.number().step(1).min(1_024).max(1_048_576).default(65_536),
    planTtlSeconds: z.number().step(1).min(30).max(86_400).default(900),
    allowMutations: z.boolean().default(false),
    allowSecretExport: z.boolean().default(false),
});
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SAFE_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/;
const SAFE_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const SAFE_INTERFACE = /^[A-Za-z0-9_.-]{1,15}$/;
const SAFE_SERVICE = /^[A-Za-z0-9_.@-]{1,128}$/;
const SAFE_REMOTE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const SAFE_SERVER_NAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
/** Apply schema defaults defensively and reject cross-field or filesystem-shaped hazards. */
export function resolveConfig(config) {
    const targets = (config.targets ?? []).map(resolveTarget);
    assertUnique('target id', targets.map(target => target.id));
    const stateDirectory = config.stateDirectory ?? DEFAULT_STATE_DIRECTORY;
    assertAbsoluteLocalPath('stateDirectory', stateDirectory);
    return Object.freeze({
        targets: Object.freeze(targets),
        stateDirectory,
        connectTimeoutSeconds: positiveInteger('connectTimeoutSeconds', config.connectTimeoutSeconds ?? 10, 120),
        commandTimeoutMs: integerRange('commandTimeoutMs', config.commandTimeoutMs ?? 120_000, 1_000, 900_000),
        maxOutputBytes: integerRange('maxOutputBytes', config.maxOutputBytes ?? 65_536, 1_024, 1_048_576),
        planTtlSeconds: integerRange('planTtlSeconds', config.planTtlSeconds ?? 900, 30, 86_400),
        allowMutations: config.allowMutations ?? false,
        allowSecretExport: config.allowSecretExport ?? false,
    });
}
/** Resolve an allowlisted target by its exact stable identifier. */
export function getTarget(config, targetId) {
    const target = config.targets.find(candidate => candidate.id === targetId);
    if (!target)
        throw new Error(`unknown targetId "${targetId}"; use vpn_targets to list the allowlist`);
    return target;
}
function resolveTarget(target) {
    assertMatch('target id', target.id, SAFE_ID);
    assertMatch(`${target.id}.host`, target.host, SAFE_HOST);
    assertMatch(`${target.id}.user`, target.user ?? 'root', SAFE_USER);
    assertAbsoluteLocalPath(`${target.id}.identityFile`, target.identityFile);
    assertAbsoluteLocalPath(`${target.id}.knownHostsFile`, target.knownHostsFile);
    if (target.identityFile === target.knownHostsFile)
        throw new Error(`${target.id}: identityFile and knownHostsFile must differ`);
    assertMatch(`${target.id}.publicEndpoint`, target.publicEndpoint, SAFE_HOST);
    assertMatch(`${target.id}.publicInterface`, target.publicInterface, SAFE_INTERFACE);
    assertMatch(`${target.id}.wireguardInterface`, target.wireguardInterface ?? 'wg0', SAFE_INTERFACE);
    assertMatch(`${target.id}.wireguardService`, target.wireguardService ?? 'wg-quick@wg0', SAFE_SERVICE);
    assertMatch(`${target.id}.xrayService`, target.xrayService ?? 'xray', SAFE_SERVICE);
    assertMatch(`${target.id}.realityServerName`, target.realityServerName, SAFE_SERVER_NAME);
    assertDestination(`${target.id}.realityDestination`, target.realityDestination);
    for (const [field, value] of [
        ['remoteStateDirectory', target.remoteStateDirectory ?? '/var/lib/dsh-vpn-ops'],
        ['wireguardConfigPath', target.wireguardConfigPath ?? '/etc/wireguard/wg0.conf'],
        ['xrayBinary', target.xrayBinary ?? '/usr/local/bin/xray'],
        ['xrayConfigPath', target.xrayConfigPath ?? '/usr/local/etc/xray/config.json'],
        ['sysctlConfigPath', target.sysctlConfigPath ?? '/etc/sysctl.d/99-dsh-vpn-ops.conf'],
    ])
        assertRemotePath(`${target.id}.${field}`, value);
    const remoteStateDirectory = target.remoteStateDirectory ?? '/var/lib/dsh-vpn-ops';
    if (!remoteStateDirectory.endsWith('/dsh-vpn-ops')) {
        throw new Error(`${target.id}.remoteStateDirectory must end with /dsh-vpn-ops to bound recursive cleanup`);
    }
    assertFileSuffix(`${target.id}.wireguardConfigPath`, target.wireguardConfigPath ?? '/etc/wireguard/wg0.conf', '.conf');
    assertFileSuffix(`${target.id}.xrayConfigPath`, target.xrayConfigPath ?? '/usr/local/etc/xray/config.json', '.json');
    assertFileSuffix(`${target.id}.sysctlConfigPath`, target.sysctlConfigPath ?? '/etc/sysctl.d/99-dsh-vpn-ops.conf', '.conf');
    const serverNetwork = parseIpv4Cidr(`${target.id}.wireguardAddress`, target.wireguardAddress ?? '10.66.66.1/24');
    if (serverNetwork.prefix > 30)
        throw new Error(`${target.id}.wireguardAddress must leave room for clients`);
    const clients = target.clients.map(client => resolveClient(target.id, client, serverNetwork));
    if (clients.length === 0)
        throw new Error(`${target.id}.clients must contain at least one client`);
    assertUnique(`${target.id} client id`, clients.map(client => client.id));
    assertUnique(`${target.id} WireGuard client address`, clients.map(client => client.wireguardAddress));
    return Object.freeze({
        id: target.id,
        host: target.host,
        user: target.user ?? 'root',
        sshPort: positiveInteger(`${target.id}.sshPort`, target.sshPort ?? 22, 65_535),
        identityFile: target.identityFile,
        knownHostsFile: target.knownHostsFile,
        sudo: target.sudo ?? false,
        publicEndpoint: target.publicEndpoint,
        publicInterface: target.publicInterface,
        remoteStateDirectory,
        wireguardInterface: target.wireguardInterface ?? 'wg0',
        wireguardAddress: target.wireguardAddress ?? '10.66.66.1/24',
        wireguardListenPort: positiveInteger(`${target.id}.wireguardListenPort`, target.wireguardListenPort ?? 51_820, 65_535),
        wireguardConfigPath: target.wireguardConfigPath ?? '/etc/wireguard/wg0.conf',
        wireguardService: target.wireguardService ?? `wg-quick@${target.wireguardInterface ?? 'wg0'}`,
        clientDns: assertIpv4(`${target.id}.clientDns`, target.clientDns ?? '1.1.1.1'),
        clientMtu: integerRange(`${target.id}.clientMtu`, target.clientMtu ?? 1_420, 1_280, 1_500),
        vlessListenAddress: assertIpv4(`${target.id}.vlessListenAddress`, target.vlessListenAddress ?? '0.0.0.0'),
        vlessPort: positiveInteger(`${target.id}.vlessPort`, target.vlessPort ?? 443, 65_535),
        realityServerName: target.realityServerName,
        realityDestination: target.realityDestination,
        xrayBinary: target.xrayBinary ?? '/usr/local/bin/xray',
        xrayConfigPath: target.xrayConfigPath ?? '/usr/local/etc/xray/config.json',
        xrayService: target.xrayService ?? 'xray',
        sysctlConfigPath: target.sysctlConfigPath ?? '/etc/sysctl.d/99-dsh-vpn-ops.conf',
        clients: Object.freeze(clients),
    });
}
function resolveClient(targetId, client, server) {
    assertMatch(`${targetId} client id`, client.id, SAFE_ID);
    const address = parseIpv4Cidr(`${targetId}.${client.id}.wireguardAddress`, client.wireguardAddress);
    if (address.prefix !== 32)
        throw new Error(`${targetId}.${client.id}.wireguardAddress must use /32`);
    if ((address.value & server.mask) !== (server.value & server.mask)) {
        throw new Error(`${targetId}.${client.id}.wireguardAddress is outside ${formatNetwork(server)}`);
    }
    if (address.value === server.value)
        throw new Error(`${targetId}.${client.id}.wireguardAddress duplicates the server address`);
    return Object.freeze({ id: client.id, wireguardAddress: client.wireguardAddress });
}
function parseIpv4Cidr(field, value) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(value);
    if (!match)
        throw new Error(`${field} must be an IPv4 CIDR`);
    const ip = match[1];
    const prefix = Number(match[2]);
    if (ip === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
        throw new Error(`${field} has an invalid prefix`);
    const numeric = ipv4ToNumber(field, ip);
    const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
    return { value: numeric, prefix, mask };
}
function assertIpv4(field, value) {
    ipv4ToNumber(field, value);
    return value;
}
function ipv4ToNumber(field, value) {
    const parts = value.split('.');
    if (parts.length !== 4)
        throw new Error(`${field} must be an IPv4 address`);
    let result = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part))
            throw new Error(`${field} must be an IPv4 address`);
        const octet = Number(part);
        if (octet < 0 || octet > 255)
            throw new Error(`${field} must be an IPv4 address`);
        result = ((result << 8) | octet) >>> 0;
    }
    return result;
}
function formatNetwork(value) {
    const network = value.value & value.mask;
    return `${[(network >>> 24) & 255, (network >>> 16) & 255, (network >>> 8) & 255, network & 255].join('.')}/${value.prefix}`;
}
function assertDestination(field, value) {
    const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(value);
    if (!match || !SAFE_SERVER_NAME.test(match[1] ?? ''))
        throw new Error(`${field} must be a DNS name followed by :port`);
    positiveInteger(`${field} port`, Number(match[2]), 65_535);
}
function assertAbsoluteLocalPath(field, value) {
    if (!isAbsolute(value) || value.includes('\0'))
        throw new Error(`${field} must be an absolute local path`);
}
function assertRemotePath(field, value) {
    if (!SAFE_REMOTE_PATH.test(value) || value.includes('/../') || value.includes('//')) {
        throw new Error(`${field} must be a normalized absolute POSIX path`);
    }
}
function assertFileSuffix(field, value, suffix) {
    if (!value.endsWith(suffix))
        throw new Error(`${field} must name a ${suffix} file`);
}
function assertMatch(field, value, pattern) {
    if (!pattern.test(value))
        throw new Error(`${field} contains unsupported characters or has an invalid shape`);
}
function positiveInteger(field, value, maximum) {
    return integerRange(field, value, 1, maximum);
}
function integerRange(field, value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${field} must be an integer from ${minimum} through ${maximum}`);
    }
    return value;
}
function assertUnique(field, values) {
    const seen = new Set();
    for (const value of values) {
        if (seen.has(value))
            throw new Error(`duplicate ${field}: ${value}`);
        seen.add(value);
    }
}
