import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LocalCommandRunner, processFailure } from './process.js';
/** Fixed-script SSH transport with strict host-key and public-key-only policy. */
export class SshTransport {
    config;
    runner;
    #helperUrl = new URL('../assets/remote/dsh-vpn-ops.sh', import.meta.url);
    constructor(config, runner = new LocalCommandRunner()) {
        this.config = config;
        this.runner = runner;
    }
    async invoke(target, action, deployment, signal, extra = {}) {
        await assertSshFiles(target);
        const helper = await readFile(this.#helperUrl, 'utf8');
        const result = await this.runner.run('ssh', sshArgs(this.config, target, action, deployment, extra), {
            input: helper,
            signal,
            timeoutMs: this.config.commandTimeoutMs,
            maxOutputBytes: this.config.maxOutputBytes,
        });
        assertSuccess('ssh', result);
        return parseKeyValue(result.stdout);
    }
    async exportToFile(target, action, deployment, destination, signal, extra) {
        await assertSshFiles(target);
        await stat(dirname(destination));
        const helper = await readFile(this.#helperUrl, 'utf8');
        return this.runner.runToFile('ssh', sshArgs(this.config, target, action, deployment, extra), destination, {
            input: helper,
            signal,
            timeoutMs: this.config.commandTimeoutMs,
            maxOutputBytes: this.config.maxOutputBytes,
        });
    }
}
function sshArgs(config, target, action, deployment, extra) {
    const environment = {
        DSH_VPN_OPS_ACTION: action,
        DSH_VPN_OPS_CONFIG_B64: deployment === undefined ? '' : Buffer.from(JSON.stringify(deployment)).toString('base64'),
        ...extra,
    };
    const remoteTokens = [
        ...(target.sudo ? ['sudo', '-n'] : []),
        'env',
        ...Object.entries(environment).map(([key, value]) => `${key}=${shellQuote(value)}`),
        '/bin/sh',
        '-s',
    ];
    return [
        '-F', '/dev/null',
        '-T',
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'PasswordAuthentication=no',
        '-o', 'KbdInteractiveAuthentication=no',
        '-o', 'PreferredAuthentications=publickey',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${target.knownHostsFile}`,
        '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', `IdentityFile=${target.identityFile}`,
        '-o', `ConnectTimeout=${config.connectTimeoutSeconds}`,
        '-o', 'ClearAllForwardings=yes',
        '-o', 'PermitLocalCommand=no',
        '-o', 'ControlMaster=no',
        '-o', 'LogLevel=ERROR',
        '-p', String(target.sshPort),
        `${target.user}@${target.host}`,
        remoteTokens.join(' '),
    ];
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
async function assertSshFiles(target) {
    const [identity, knownHosts] = await Promise.all([stat(target.identityFile), stat(target.knownHostsFile)]);
    if (!identity.isFile())
        throw new Error(`${target.id}: identityFile is not a regular file`);
    if ((identity.mode & 0o077) !== 0)
        throw new Error(`${target.id}: identityFile must not be accessible by group or others`);
    if (!knownHosts.isFile() || knownHosts.size === 0)
        throw new Error(`${target.id}: knownHostsFile must be a non-empty regular file`);
}
function assertSuccess(command, result) {
    if (result.exitCode !== 0)
        throw processFailure(command, result.exitCode, result.stderr, result.truncated);
    if (result.truncated)
        throw new Error(`${command} output exceeded the configured bound`);
}
/** Parse the helper's deliberately tiny, newline-delimited response protocol. */
export function parseKeyValue(output) {
    const result = {};
    for (const rawLine of output.split('\n')) {
        const line = rawLine.trimEnd();
        if (line === '')
            continue;
        const separator = line.indexOf('=');
        if (separator < 1)
            throw new Error('remote helper returned an invalid response line');
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        if (!/^[a-z][a-z0-9_]*$/.test(key) || Object.hasOwn(result, key)) {
            throw new Error('remote helper returned an invalid or duplicate response key');
        }
        if (value.includes('\0') || value.length > 8_192)
            throw new Error(`remote helper value for ${key} is invalid`);
        result[key] = value;
    }
    if (result.schema !== '1')
        throw new Error('remote helper response schema is unsupported');
    return Object.freeze(result);
}
