import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LocalCommandRunner, processFailure } from '../src/process.js'

const runner = new LocalCommandRunner()

describe('LocalCommandRunner', () => {
  it('captures bounded stdout and stderr without a shell', async () => {
    const result = await runner.run(process.execPath, ['-e', 'process.stdout.write("abcdef"); process.stderr.write("warn")'], {
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      maxOutputBytes: 4,
    })
    expect(result).toEqual({ exitCode: 0, stdout: 'abcd', stderr: 'warn', truncated: true })
  })

  it('times out and aborts a child', async () => {
    await expect(runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: new AbortController().signal,
      timeoutMs: 20,
      maxOutputBytes: 1_024,
    })).rejects.toThrow(/timed out/)

    const controller = new AbortController()
    controller.abort()
    await expect(runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    })).rejects.toThrow(/aborted/)
  })

  it('streams secret output to a 0600 file and returns only evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vpn-export-'))
    const destination = join(directory, 'client.conf')
    const secret = 'PrivateKey = test-secret\n'
    const result = await runner.runToFile(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(secret)})`], destination, {
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    })
    expect(await readFile(destination, 'utf8')).toBe(secret)
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    expect(result).toMatchObject({ bytes: Buffer.byteLength(secret), sha256: createHash('sha256').update(secret).digest('hex') })
    expect(JSON.stringify(result)).not.toContain('test-secret')
  })

  it('removes partial files when an export exceeds its bound', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vpn-export-'))
    const destination = join(directory, 'oversized.conf')
    await expect(runner.runToFile(process.execPath, ['-e', 'process.stdout.write("x".repeat(100))'], destination, {
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      maxOutputBytes: 10,
    })).rejects.toThrow(/exceeded/)
    await expect(stat(destination)).rejects.toThrow()
  })

  it('formats non-secret process failures with truncation evidence', () => {
    expect(processFailure('ssh', 1, '', false).message).toBe('ssh exited with 1')
    expect(processFailure('ssh', 2, 'one\ntwo', true).message).toBe('ssh exited with 2: one two (output truncated)')
  })
})
