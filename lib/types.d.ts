/** One WireGuard/VLESS client identity managed on a target. */
export interface ClientConfig {
    /** Stable, non-secret identifier used in filenames and logs. */
    id: string;
    /** WireGuard client address as an IPv4 /32 CIDR. */
    wireguardAddress: string;
}
/** One allowlisted SSH target and its complete deployment policy. */
export interface TargetConfig {
    id: string;
    host: string;
    user?: string;
    sshPort?: number;
    identityFile: string;
    knownHostsFile: string;
    sudo?: boolean;
    publicEndpoint: string;
    publicInterface: string;
    remoteStateDirectory?: string;
    wireguardInterface?: string;
    wireguardAddress?: string;
    wireguardListenPort?: number;
    wireguardConfigPath?: string;
    wireguardService?: string;
    clientDns?: string;
    clientMtu?: number;
    vlessListenAddress?: string;
    vlessPort?: number;
    realityServerName: string;
    realityDestination: string;
    xrayBinary?: string;
    xrayConfigPath?: string;
    xrayService?: string;
    sysctlConfigPath?: string;
    clients: ClientConfig[];
}
/** Plugin policy and configured allowlist. */
export interface Config {
    targets?: TargetConfig[];
    stateDirectory?: string;
    connectTimeoutSeconds?: number;
    commandTimeoutMs?: number;
    maxOutputBytes?: number;
    planTtlSeconds?: number;
    allowMutations?: boolean;
    allowSecretExport?: boolean;
}
/** Validated client used internally. */
export interface ResolvedClientConfig {
    readonly id: string;
    readonly wireguardAddress: string;
}
/** Validated target with all deployment defaults materialized. */
export interface ResolvedTargetConfig {
    readonly id: string;
    readonly host: string;
    readonly user: string;
    readonly sshPort: number;
    readonly identityFile: string;
    readonly knownHostsFile: string;
    readonly sudo: boolean;
    readonly publicEndpoint: string;
    readonly publicInterface: string;
    readonly remoteStateDirectory: string;
    readonly wireguardInterface: string;
    readonly wireguardAddress: string;
    readonly wireguardListenPort: number;
    readonly wireguardConfigPath: string;
    readonly wireguardService: string;
    readonly clientDns: string;
    readonly clientMtu: number;
    readonly vlessListenAddress: string;
    readonly vlessPort: number;
    readonly realityServerName: string;
    readonly realityDestination: string;
    readonly xrayBinary: string;
    readonly xrayConfigPath: string;
    readonly xrayService: string;
    readonly sysctlConfigPath: string;
    readonly clients: readonly ResolvedClientConfig[];
}
/** Validated plugin policy. */
export interface ResolvedConfig {
    readonly targets: readonly ResolvedTargetConfig[];
    readonly stateDirectory: string;
    readonly connectTimeoutSeconds: number;
    readonly commandTimeoutMs: number;
    readonly maxOutputBytes: number;
    readonly planTtlSeconds: number;
    readonly allowMutations: boolean;
    readonly allowSecretExport: boolean;
}
/** Data encoded for the fixed remote helper. It deliberately contains no private key material. */
export interface RemoteDeploymentConfig {
    readonly schemaVersion: 1;
    readonly targetId: string;
    readonly planId: string;
    readonly publicEndpoint: string;
    readonly publicInterface: string;
    readonly remoteStateDirectory: string;
    readonly wireguardInterface: string;
    readonly wireguardAddress: string;
    readonly wireguardListenPort: number;
    readonly wireguardConfigPath: string;
    readonly wireguardService: string;
    readonly clientDns: string;
    readonly clientMtu: number;
    readonly vlessListenAddress: string;
    readonly vlessPort: number;
    readonly realityServerName: string;
    readonly realityDestination: string;
    readonly xrayBinary: string;
    readonly xrayConfigPath: string;
    readonly xrayService: string;
    readonly sysctlConfigPath: string;
    readonly clients: readonly ResolvedClientConfig[];
}
/** Non-secret plan persisted locally between plan and apply. */
export interface PlanRecord {
    readonly schemaVersion: 1;
    readonly planId: string;
    readonly targetId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly configDigest: string;
    readonly baselineDeploymentId: string;
    readonly baselineStateFingerprint: string;
}
/** Bounded child-process result. */
export interface ProcessResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
}
