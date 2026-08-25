import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as {
  devEngines?: { packageManager?: { name?: string; version?: string } }
  packageManager?: string
}

describe('package manager metadata', () => {
  it('pins Corepack to pnpm 11.19.0', () => {
    expect(packageJson.packageManager).toBe('pnpm@11.19.0')
    expect(packageJson.devEngines?.packageManager).toMatchObject({
      name: 'pnpm',
      version: '11.19.0',
    })
  })
})
