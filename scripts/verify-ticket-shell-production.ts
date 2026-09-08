import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export type BoundaryViolation = { file: string; rule: string }

type SourceAnalysis = {
  reachable: ReadonlySet<string>
  violations: readonly BoundaryViolation[]
}

const forbiddenSpecifiers = new Set(['react-email', 'resend'])
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'] as const

const builtSentinels = [
  { rule: 'built-sentinel:collection-fixture', values: ['wh_test_collection_'] },
  { rule: 'built-sentinel:admission-fixture', values: ['wh_test_admit_'] },
  { rule: 'built-sentinel:development-label', values: ['Development only'] },
  { rule: 'built-sentinel:demo-data', values: ['Demo data'] },
  { rule: 'built-sentinel:email-preview-route', values: ['/__dev/ticket-shells/emails/'] },
  { rule: 'built-sentinel:qr-lab-route', values: ['/__dev/ticket-shells/qr/'] },
  { rule: 'built-sentinel:resend-env', values: ['RESEND_API_KEY'] },
  {
    rule: 'built-sentinel:manual-scanner-input',
    values: ['Fake admission credential', 'Development-only fake credential', 'Submit fake credential'],
  },
] as const

function normalize(file: string) {
  return file.split(path.sep).join('/')
}

function displayFile(file: string, root: string) {
  const relative = path.relative(root, file)
  return normalize(relative.startsWith('..') ? path.basename(file) : relative)
}

function sourceRule(file: string): string | null {
  const normalized = normalize(file)

  if (normalized.includes('/fixtures/')) return 'forbidden-path:fixtures'
  if (normalized.includes('/DevelopmentScannerPage.')) return 'forbidden-path:manual-scanner'
  if (normalized.includes('/main.development.')) return 'forbidden-path:development-entry'
  if (normalized.includes('/ticket-experience/runtime/development.')) return 'forbidden-path:development-runtime'
  if (normalized.includes('/EventDashboardPage.')) return 'forbidden-path:dashboard-implementation'
  if (normalized.includes('/EmailPreviewPage.')) return 'forbidden-path:email-preview'
  if (normalized.includes('/emailPreviewScenarios.')) return 'forbidden-path:email-preview-scenarios'
  if (normalized.includes('/DevelopmentQrLabPage.')) return 'forbidden-path:qr-lab'
  if (normalized.includes('/send-ticket-ready-test.')) return 'forbidden-path:resend-test-tooling'

  return null
}

function forbiddenSpecifierRule(specifier: string): string | null {
  if (forbiddenSpecifiers.has(specifier) || specifier.startsWith('@react-email/')) {
    return `forbidden-specifier:${specifier}`
  }

  return null
}

function resolveSourceModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const requested = path.resolve(path.dirname(importer), specifier)
  const extension = path.extname(requested)
  const candidates: string[] = []

  if (sourceExtensions.includes(extension as (typeof sourceExtensions)[number])) {
    candidates.push(requested)
  } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    const withoutExtension = requested.slice(0, -extension.length)
    candidates.push(...sourceExtensions.map((sourceExtension) => `${withoutExtension}${sourceExtension}`))
  } else if (extension === '') {
    candidates.push(...sourceExtensions.map((sourceExtension) => `${requested}${sourceExtension}`))
    candidates.push(...sourceExtensions.map((sourceExtension) => path.join(requested, `index${sourceExtension}`)))
  }

  const match = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  return match ? realpathSync(match) : null
}

function scriptKindFor(file: string) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) return ts.ScriptKind.TS
  return ts.ScriptKind.Unknown
}

function analyzeSource(entry: string): SourceAnalysis {
  const canonicalEntry = realpathSync(entry)
  const root = path.dirname(canonicalEntry)
  const reachable = new Set<string>()
  const violations: BoundaryViolation[] = []
  const pending = [canonicalEntry]

  const addViolation = (file: string, rule: string) => {
    if (!violations.some((violation) => violation.file === file && violation.rule === rule)) {
      violations.push({ file, rule })
    }
  }

  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || reachable.has(file)) continue

    reachable.add(file)
    const displayedFile = displayFile(file, root)
    const rule = sourceRule(file)
    if (rule) addViolation(displayedFile, rule)

    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(file),
    )

    const inspectSpecifier = (specifier: string) => {
      const specifierRule = forbiddenSpecifierRule(specifier)
      if (specifierRule) addViolation(displayedFile, specifierRule)

      const resolved = resolveSourceModule(file, specifier)
      if (resolved && !reachable.has(resolved)) pending.push(resolved)
    }

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          inspectSpecifier(node.moduleSpecifier.text)
        }
      } else if (
        ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
          addViolation(displayedFile, 'nonliteral-dynamic-import')
        } else {
          inspectSpecifier(node.arguments[0].text)
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(source)
  }

  return { reachable, violations }
}

export function collectReachableModules(entry: string): ReadonlySet<string> {
  return analyzeSource(entry).reachable
}

export function inspectSourceBoundary(entry: string): readonly BoundaryViolation[] {
  return analyzeSource(entry).violations
}

function builtFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return builtFiles(target)
    return /\.(?:html|js)$/.test(entry.name) ? [target] : []
  })
}

function containsResendTooling(contents: string) {
  const matches = contents.matchAll(/\bresend\b/gi)

  for (const match of matches) {
    const index = match.index
    if (index === undefined || match[0] !== 'resend') return true

    const before = contents.slice(Math.max(0, index - 80), index)
    const after = contents.slice(index, index + 280)
    const isSupabasePushMethod = /^resend\([^)]*\)\s*\{.{0,180}this\.timeout=.{0,100}this\.reset\(\).{0,100}this\.send\(\)/s.test(after)
    const isSupabaseJoinPushCall = /this\.joinPush\.$/.test(before)
    const isSupabaseAuthMethod = /^resend\([^)]*\)\s*\{.{0,240}(?:\/auth\/v1\/resend|this\.url\}\/resend)/s.test(after)
    const isSupabaseAuthEndpoint = /(?:auth\/v1|\$\{this\.url\})\/$/.test(before)

    if (
      !isSupabasePushMethod
      && !isSupabaseJoinPushCall
      && !isSupabaseAuthMethod
      && !isSupabaseAuthEndpoint
    ) return true
  }

  return false
}

export function inspectBuiltOutput(distDirectory: string): readonly BoundaryViolation[] {
  const canonicalDirectory = realpathSync(distDirectory)
  const violations: BoundaryViolation[] = []

  for (const file of builtFiles(canonicalDirectory)) {
    const contents = readFileSync(file, 'utf8')
    const displayedFile = displayFile(file, canonicalDirectory)

    for (const sentinel of builtSentinels) {
      if (sentinel.values.some((value) => contents.includes(value))) {
        violations.push({ file: displayedFile, rule: sentinel.rule })
      }
    }

    if (containsResendTooling(contents)) {
      violations.push({ file: displayedFile, rule: 'built-sentinel:resend-package' })
    }
  }

  return violations
}

export function verifyTicketShellProduction(input: {
  entry: string
  distDirectory: string
}): void {
  const violations = [
    ...inspectSourceBoundary(input.entry),
    ...inspectBuiltOutput(input.distDirectory),
  ]

  if (violations.length > 0) {
    const summary = violations.map(({ file, rule }) => `${file} (${rule})`).join('\n')
    throw new Error(`Ticket shell production boundary failed:\n${summary}`)
  }
}

function argumentValue(name: string) {
  const position = process.argv.indexOf(name)
  if (position === -1) return undefined
  const value = process.argv[position + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return value
}

function main() {
  const entry = path.resolve(argumentValue('--entry') ?? 'src/main.tsx')
  const distDirectory = path.resolve(argumentValue('--dist') ?? 'dist')

  try {
    verifyTicketShellProduction({ entry, distDirectory })
    console.info('ticket-shell-production=passed')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Ticket shell production boundary failed')
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
