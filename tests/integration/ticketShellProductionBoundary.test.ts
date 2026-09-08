import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectReachableModules,
  inspectBuiltOutput,
  inspectSourceBoundary,
  verifyTicketShellProduction,
} from '../../scripts/verify-ticket-shell-production'

const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function writeGraph(files: Readonly<Record<string, string>>) {
  const directory = await makeTemporaryDirectory('ticket-shell-boundary-')

  await Promise.all(Object.entries(files).map(async ([file, source]) => {
    const target = path.join(directory, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }))

  return directory
}

function rulesFor(violations: readonly { rule: string }[]) {
  return violations.map(({ rule }) => rule)
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('ticket shell production source boundary', () => {
  it('follows TypeScript imports and re-exports in a clean graph', async () => {
    const directory = await writeGraph({
      'main.ts': [
        "import './side-effect'",
        "export { named } from './named.js'",
        "export * from './star'",
        "void import('./lazy')",
      ].join('\n'),
      'side-effect.ts': 'export const sideEffect = true',
      'named.tsx': 'export const named = true',
      'star/index.ts': 'export const starred = true',
      'lazy.ts': 'export const lazy = true',
    })

    const reachable = [...collectReachableModules(path.join(directory, 'main.ts'))]

    expect(reachable).toHaveLength(5)
    expect(inspectSourceBoundary(path.join(directory, 'main.ts'))).toEqual([])
  })

  it.each([
    ['static relative import', "import './fixtures/adapters'", 'fixtures/adapters.ts', 'forbidden-path:fixtures'],
    ['named re-export', "export { leaked } from './fixtures/adapters'", 'fixtures/adapters.ts', 'forbidden-path:fixtures'],
    ['star re-export', "export * from './ticket-experience/scanner/DevelopmentScannerPage'", 'ticket-experience/scanner/DevelopmentScannerPage.ts', 'forbidden-path:manual-scanner'],
  ])('rejects a %s into development-only source', async (_name, statement, target, expectedRule) => {
    const directory = await writeGraph({
      'main.ts': statement,
      [target]: 'export const leaked = true',
    })

    expect(rulesFor(inspectSourceBoundary(path.join(directory, 'main.ts')))).toContain(expectedRule)
  })

  it.each([
    ['main.development.ts', 'forbidden-path:development-entry'],
    ['ticket-experience/runtime/development.ts', 'forbidden-path:development-runtime'],
    ['EventDashboardPage.tsx', 'forbidden-path:dashboard-implementation'],
    ['EmailPreviewPage.tsx', 'forbidden-path:email-preview'],
    ['email/emailPreviewScenarios.ts', 'forbidden-path:email-preview-scenarios'],
    ['DevelopmentQrLabPage.tsx', 'forbidden-path:qr-lab'],
    ['send-ticket-ready-test.ts', 'forbidden-path:resend-test-tooling'],
  ])('rejects the explicitly forbidden module %s', async (target, expectedRule) => {
    const directory = await writeGraph({
      'main.ts': `import './${target}'`,
      [target]: 'export const leaked = true',
    })

    expect(rulesFor(inspectSourceBoundary(path.join(directory, 'main.ts')))).toContain(expectedRule)
  })

  it.each([
    'resend',
    'react-email',
    '@react-email/render',
  ])('rejects the forbidden browser package %s', async (specifier) => {
    const directory = await writeGraph({
      'main.ts': `import ${JSON.stringify(specifier)}`,
    })

    expect(rulesFor(inspectSourceBoundary(path.join(directory, 'main.ts')))).toContain(
      `forbidden-specifier:${specifier}`,
    )
  })

  it('fails closed for a nonliteral dynamic import', async () => {
    const directory = await writeGraph({
      'main.ts': "const moduleName = './runtime'; void import(moduleName)",
      'runtime.ts': 'export const runtime = true',
    })

    expect(rulesFor(inspectSourceBoundary(path.join(directory, 'main.ts')))).toContain(
      'nonliteral-dynamic-import',
    )
  })

  it('allows the approved production scanner and QR components', async () => {
    const directory = await writeGraph({
      'main.ts': "import './ticket-experience/scanner/cameraDecoder'; import 'qrcode.react'; import '@zxing/browser'",
      'ticket-experience/scanner/cameraDecoder.ts': 'export const decoder = true',
    })
    expect(inspectSourceBoundary(path.join(directory, 'main.ts'))).toEqual([])
  })

  it('keeps the real production entry free of development ticket tooling', () => {
    expect(inspectSourceBoundary(path.resolve('src/main.tsx'))).toEqual([])
  })
})

describe('ticket shell production build boundary', () => {
  it('reports safe rule names for every forbidden built-output sentinel', async () => {
    const directory = await writeGraph({
      'assets/application.js': [
        'wh_test_collection_paid',
        'wh_test_admit_paid_valid',
        'Development only',
        'Demo data',
        '/__dev/ticket-shells/emails/tickets-ready/paid',
        '/__dev/ticket-shells/qr/32-11',
        'RESEND_API_KEY',
        'https://api.resend.com',
        'Fake admission credential',
      ].join('\n'),
      'index.html': '<script src="/assets/application.js"></script>',
    })

    expect(new Set(rulesFor(inspectBuiltOutput(directory)))).toEqual(new Set([
      'built-sentinel:collection-fixture',
      'built-sentinel:admission-fixture',
      'built-sentinel:development-label',
      'built-sentinel:demo-data',
      'built-sentinel:email-preview-route',
      'built-sentinel:qr-lab-route',
      'built-sentinel:resend-env',
      'built-sentinel:resend-package',
      'built-sentinel:manual-scanner-input',
    ]))
  })

  it('throws only safe filenames and rule identifiers', async () => {
    const directory = await writeGraph({
      'main.ts': "import './fixtures/privateCredentialRegistry'",
      'fixtures/privateCredentialRegistry.ts': 'export const privateValue = true',
      'dist/application.js': 'wh_test_admit_private_value',
    })

    expect(() => verifyTicketShellProduction({
      entry: path.join(directory, 'main.ts'),
      distDirectory: path.join(directory, 'dist'),
    })).toThrowError(/fixtures\/privateCredentialRegistry\.ts.*forbidden-path:fixtures/)

    try {
      verifyTicketShellProduction({
        entry: path.join(directory, 'main.ts'),
        distDirectory: path.join(directory, 'dist'),
      })
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : String(error)
      expect(diagnostic).not.toContain('wh_test_admit_private_value')
      expect(diagnostic).not.toContain('export const privateValue')
    }
  })

  it('does not confuse the existing Supabase auth resend operation with Resend tooling', async () => {
    const directory = await writeGraph({
      'application.js': [
        'async resend(input) { return fetch(`/auth/v1/resend`, input) }',
        'this.joinPush.resend(input)',
      ].join('\n'),
    })

    expect(inspectBuiltOutput(directory)).toEqual([])
  })

  it('detects Resend provider output without relying on one SDK URL', async () => {
    const directory = await writeGraph({
      'application.js': 'console.error("[Resend API Error]")',
    })

    expect(rulesFor(inspectBuiltOutput(directory))).toContain('built-sentinel:resend-package')
  })

  it('does not exempt a non-Supabase resend call', async () => {
    const directory = await writeGraph({
      'application.js': 'client.resend(message)',
    })

    expect(rulesFor(inspectBuiltOutput(directory))).toContain('built-sentinel:resend-package')
  })
})
