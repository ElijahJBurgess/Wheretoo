import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const evidenceRoot = 'test-results/icon-library-phase5b'
export const buildDirectory = `${evidenceRoot}/baseline-build`
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function manifest(roots) {
  const entries = []
  function walk(path) {
    if (!existsSync(path)) return
    if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name))
    else entries.push([path, sha256(readFileSync(path))])
  }
  roots.forEach(walk)
  return { hash: sha256(JSON.stringify(entries)), entries }
}
export const sourceIdentity = () => manifest(['src', 'public', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts'])
export const buildIdentity = () => manifest([buildDirectory])
