import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, link, rm } from 'node:fs/promises';
/** Spawn argv directly, bound time and output, and never invoke a local shell. */
export class LocalCommandRunner {
    async run(command, args, options) {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const stdout = [];
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let truncated = false;
        child.stdout.on('data', (chunk) => {
            const accepted = boundedChunk(chunk, stdoutBytes, options.maxOutputBytes);
            stdoutBytes += accepted.length;
            if (accepted.length > 0)
                stdout.push(accepted);
            if (accepted.length !== chunk.length)
                truncated = true;
        });
        child.stderr.on('data', (chunk) => {
            const accepted = boundedChunk(chunk, stderrBytes, options.maxOutputBytes);
            stderrBytes += accepted.length;
            if (accepted.length > 0)
                stderr.push(accepted);
            if (accepted.length !== chunk.length)
                truncated = true;
        });
        if (options.input !== undefined)
            child.stdin.end(options.input);
        else
            child.stdin.end();
        const exitCode = await settleChild(child, options);
        return {
            exitCode,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            truncated,
        };
    }
    async runToFile(command, args, destination, options) {
        const temporary = `${destination}.partial-${process.pid}-${Date.now()}`;
        const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const digest = createHash('sha256');
        const stderr = [];
        let bytes = 0;
        let stderrBytes = 0;
        let truncated = false;
        let oversized = false;
        child.stdout.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > options.maxOutputBytes) {
                oversized = true;
                child.kill('SIGTERM');
                return;
            }
            digest.update(chunk);
            if (!output.write(chunk))
                child.stdout.pause();
        });
        output.on('drain', () => child.stdout.resume());
        child.stderr.on('data', (chunk) => {
            const accepted = boundedChunk(chunk, stderrBytes, options.maxOutputBytes);
            stderrBytes += accepted.length;
            if (accepted.length > 0)
                stderr.push(accepted);
            if (accepted.length !== chunk.length)
                truncated = true;
        });
        child.stdout.on('end', () => output.end());
        if (options.input !== undefined)
            child.stdin.end(options.input);
        else
            child.stdin.end();
        try {
            const [exitCode] = await Promise.all([
                settleChild(child, options),
                new Promise((resolve, reject) => {
                    output.once('finish', resolve);
                    output.once('error', reject);
                }),
            ]);
            if (oversized)
                throw new Error(`secret export exceeded ${options.maxOutputBytes} bytes`);
            if (exitCode !== 0)
                throw processFailure(command, exitCode, Buffer.concat(stderr).toString('utf8'), truncated);
            await chmod(temporary, 0o600);
            await link(temporary, destination);
            await rm(temporary);
            return { bytes, sha256: digest.digest('hex'), stderr: Buffer.concat(stderr).toString('utf8'), truncated };
        }
        catch (error) {
            output.destroy();
            await rm(temporary, { force: true });
            if (oversized)
                throw new Error(`secret export exceeded ${options.maxOutputBytes} bytes`);
            throw error;
        }
    }
}
function boundedChunk(chunk, current, maximum) {
    const remaining = Math.max(0, maximum - current);
    return remaining === 0 ? Buffer.alloc(0) : chunk.subarray(0, remaining);
}
function settleChild(child, options) {
    return new Promise((resolve, reject) => {
        let timedOut = false;
        let aborted = false;
        const killTimer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
        }, options.timeoutMs);
        killTimer.unref();
        const onAbort = () => {
            aborted = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.signal.aborted)
            onAbort();
        child.once('error', (error) => {
            cleanup();
            reject(error);
        });
        child.once('close', (code, signal) => {
            cleanup();
            if (aborted)
                reject(new Error('operation aborted'));
            else if (timedOut)
                reject(new Error(`operation timed out after ${options.timeoutMs} ms`));
            else if (code === null)
                reject(new Error(`process terminated by ${signal ?? 'unknown signal'}`));
            else
                resolve(code);
        });
        function cleanup() {
            clearTimeout(killTimer);
            options.signal.removeEventListener('abort', onAbort);
        }
    });
}
/** Render a contained process failure without leaking input or environment. */
export function processFailure(command, exitCode, stderr, truncated) {
    const detail = stderr.trim().replaceAll(/[\r\n]+/g, ' ').slice(0, 1_000);
    const suffix = truncated ? ' (output truncated)' : '';
    return new Error(`${command} exited with ${exitCode}${detail ? `: ${detail}` : ''}${suffix}`);
}
