import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name, registerTools } from '../src/index.js'
import type { VpnOperationsApi } from '../src/operations.js'

interface CapturedTool {
  readonly name: string
  execute(args: Record<string, string>, execution: { signal: AbortSignal }): Promise<unknown>
  output: { render(args: unknown, value: unknown): unknown }
  presentCall?: (args: Record<string, string>) => unknown
}

describe('plugin surface', () => {
  it('exports the expected Cordis lifecycle identity', () => {
    expect(name).toBe('vpn-ops')
    expect(inject).toEqual(['tools'])
    expect(typeof apply).toBe('function')
  })

  it('registers eight typed model surfaces and unregisters through the registry effect', async () => {
    const tools: CapturedTool[] = []
    const register = vi.fn((tool: CapturedTool) => {
      tools.push(tool)
      return () => undefined
    })
    const ctx = { tools: { register } } as unknown as Context
    const operations = fakeOperations()
    registerTools(ctx, operations)

    expect(tools.map(tool => tool.name)).toEqual([
      'vpn_targets', 'vpn_preflight', 'vpn_status', 'vpn_plan',
      'vpn_apply', 'vpn_verify', 'vpn_rollback', 'vpn_export_client',
    ])
    expect(register).toHaveBeenCalledTimes(8)
    const targets = tools.find(tool => tool.name === 'vpn_targets')!
    const targetValue = await targets.execute({}, { signal: new AbortController().signal })
    expect(targetValue).toEqual([
      { id: 'edge', mutationEnabled: false, secretExportEnabled: false, clientIds: ['phone'] },
    ])
    expect(targets.output.render({}, targetValue)).toEqual([{ type: 'text', text: JSON.stringify(targetValue, null, 2) }])
    expect(targets.presentCall?.({})).toMatchObject({ card: 'generic', kind: 'read' })

    const calls: Record<string, Record<string, string>> = {
      vpn_preflight: { targetId: 'edge' },
      vpn_status: { targetId: 'edge' },
      vpn_plan: { targetId: 'edge' },
      vpn_apply: { targetId: 'edge', planId: '0'.repeat(64), confirmation: `APPLY edge ${'0'.repeat(64)}` },
      vpn_verify: { targetId: 'edge' },
      vpn_rollback: { targetId: 'edge', backupId: '20260821T120000Z-1234abcd', confirmation: 'ROLLBACK edge 20260821T120000Z-1234abcd' },
      vpn_export_client: { targetId: 'edge', clientId: 'phone', confirmation: 'EXPORT edge phone' },
    }
    for (const tool of tools.slice(1)) {
      const args = calls[tool.name]!
      const value = await tool.execute(args, { signal: new AbortController().signal })
      expect(value).toBeDefined()
      expect(tool.output.render(args, value)).toEqual([{ type: 'text', text: JSON.stringify(value, null, 2) }])
      expect(tool.presentCall?.(args)).toMatchObject({ card: 'generic', rawInput: 'edge' })
    }
  })

  it('loads and unloads all tools through real Cordis and DSH registries', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const mount = Object.assign((inner: Context) => apply(inner, {}), { inject })
    const fiber = await ctx.plugin(mount)
    expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('vpn_'))).toHaveLength(8)
    await fiber.dispose()
    expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('vpn_'))).toEqual([])
    await ctx.fiber.dispose()
  })
})

function fakeOperations(): VpnOperationsApi {
  return {
    targets: () => [{ id: 'edge', mutationEnabled: false, secretExportEnabled: false, clientIds: ['phone'] }],
    preflight: async targetId => ({ targetId, ready: true, osId: 'ubuntu', architecture: 'x86_64', effectiveUid: 0, missingCommands: [], localPolicy: [] }),
    status: async targetId => ({ targetId, deploymentId: '', backupId: '', stateFingerprint: 'f'.repeat(64), wireguardActive: false, xrayActive: false, wireguardPeers: 0, latestHandshakeEpoch: 0, wireguardPortListening: false, vlessPortListening: false }),
    plan: async targetId => ({ targetId, planId: '0'.repeat(64), expiresAt: '', baselineDeploymentId: '', baselineStateFingerprint: 'f'.repeat(64), changes: [], mutationEnabled: false, confirmation: '' }),
    apply: async targetId => ({ targetId, deploymentId: '', backupId: '', changed: false, remoteClientDirectory: '', verification: verification(targetId) }),
    verify: async targetId => verification(targetId),
    rollback: async targetId => ({ targetId, backupId: '', restored: true, verification: verification(targetId) }),
    exportClient: async (targetId, clientId) => ({ targetId, clientId, deploymentId: '', files: [], sha256: [], bytes: [] }),
  }
}

function verification(targetId: string) {
  return { targetId, ok: true, wireguardConfigValid: true, xrayConfigValid: true, servicesActive: true, portsListening: true, handshakesSeen: false, details: [] }
}
