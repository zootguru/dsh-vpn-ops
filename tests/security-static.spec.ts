import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('published security evidence', () => {
  it('contains no legacy deployment identity or unsafe downloader pattern', async () => {
    const helper = await readFile(new URL('../assets/remote/dsh-vpn-ops.sh', import.meta.url), 'utf8')
    expect(helper).not.toMatch(/curl[^\n]*\|\s*(?:ba)?sh/)
    expect(helper).not.toContain('set -x')
  })

  it('ships no package lifecycle hook', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> }
    for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
      expect(manifest.scripts?.[name]).toBeUndefined()
    }
  })
})
