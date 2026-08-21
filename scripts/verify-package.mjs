import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const requiredFiles = [
  'lib/index.js',
  'lib/index.d.ts',
  'assets/remote/dsh-vpn-ops.sh',
  'cordis.patch.yml',
  'README.md',
  'SECURITY.md',
  'LICENSE',
]

for (const file of requiredFiles) {
  const metadata = await stat(resolve(root, file))
  if (!metadata.isFile() || metadata.size === 0) throw new Error(`missing or empty package file: ${file}`)
}

for (const forbidden of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
  if (manifest.scripts?.[forbidden]) throw new Error(`forbidden lifecycle script: ${forbidden}`)
}

if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('invalid dsh.bundle.patch')
if (manifest.peerDependencies?.['@deepseek-ai/dsh-tools'] !== '0.1.1-rc.2') {
  throw new Error('DSH tools compatibility must be pinned to the verified runtime')
}

console.log(`package evidence OK: ${manifest.name}@${manifest.version}`)
