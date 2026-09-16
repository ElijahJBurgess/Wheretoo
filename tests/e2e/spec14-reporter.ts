import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { FullConfig, FullResult, Reporter, TestCase, TestError, TestResult, Suite } from '@playwright/test/reporter'

/** Redacts both absolute navigation links and private relative link/credential forms. */
export function sanitizeSpec14Evidence(input: string): string {
  return input
    .replace(/https?:\/\/[^\s"'<>`]+/gi, '[redacted-url]')
    .replace(/(?:\/tickets\/(?!recover(?:\b|\/))|\/orders\/|\/rsvp\/)[A-Za-z0-9_\-/]+/g, '[redacted-private-route]')
    .replace(/\/(?:ticket-access|refund-details|event-status)(?:[?#][^\s"'<>`]+)?/g, '[redacted-private-route]')
    .replace(/(?:Bearer\s+)[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[redacted-jwt]')
    .replace(/\b(?:rsvp_|admission_|adm_|ticket_|refund_|recovery_)[A-Za-z0-9_-]{20,}/g, '[redacted-proof]')
    .replace(/[A-Za-z0-9_-]{43,}/g, '[redacted-long-token]')
    .replace(/data:image\/[^\s"'<>]+/gi, '[redacted-qr-artifact]')
}

export default class Spec14Reporter implements Reporter {
  private output = resolve('.superpowers/spec14/playwright')
  onBegin(config: FullConfig, suite: Suite) {
    this.output = resolve(config.projects[0]?.outputDir ?? this.output)
    process.stdout.write(`Spec14 connected local journeys: ${suite.allTests().length} selected; private evidence redaction enabled.\n`)
  }
  onStdOut(chunk: string | Buffer) { process.stdout.write(sanitizeSpec14Evidence(chunk.toString())) }
  onStdErr(chunk: string | Buffer) { process.stderr.write(sanitizeSpec14Evidence(chunk.toString())) }
  onError(error: TestError) { process.stderr.write(sanitizeSpec14Evidence(error.message ?? 'Runner error') + '\n') }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const attachment of result.attachments) {
      if (attachment.path) this.sanitizeArtifact(attachment.path)
      if (attachment.body && /json|text|xml/.test(attachment.contentType)) attachment.body = Buffer.from(sanitizeSpec14Evidence(attachment.body.toString()))
    }
    process.stdout.write(sanitizeSpec14Evidence(`${result.status}: ${test.title}\n`))
    for (const error of result.errors) process.stdout.write(sanitizeSpec14Evidence(error.message ?? 'Test failed') + '\n')
  }
  onEnd(result: FullResult) {
    this.sanitizeArtifacts()
    process.stdout.write(`Spec14 run: ${result.status}. Full journey completion requires the ledger's remaining matrix to be empty.\n`)
  }
  async onExit() { this.sanitizeArtifacts() }
  private sanitizeArtifacts() {
    const walk = (path: string) => {
      if (!existsSync(path)) return
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = resolve(path, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) walk(child)
        else this.sanitizeArtifact(child)
      }
    }
    walk(this.output)
  }
  private sanitizeArtifact(path: string) {
    const absolute = resolve(path)
    if (!absolute.startsWith(this.output + sep) || !existsSync(absolute) || !statSync(absolute).isFile()) return
    chmodSync(absolute, 0o600)
    if (/\.(?:md|txt|json|log|html)$/i.test(absolute)) {
      const original = readFileSync(absolute, 'utf8')
      writeFileSync(absolute, sanitizeSpec14Evidence(original), { mode: 0o600 })
    }
  }
}
