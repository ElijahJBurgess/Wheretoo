#!/usr/bin/env node
/**
 * Guarded manual access to the existing Spec14 local control gateway.
 * Output is a closed summary; provider IDs, payloads and control secrets are
 * never printed.
 */
const path = require('node:path')
const { execFileSync } = require('node:child_process')

require('tsx/cjs')
const harness = require('./support/spec14Harness.ts')

const root = path.resolve(__dirname, '../..')
const usage = 'Usage: node tests/e2e/spec14-control.cjs state | moderation-mode <approve|review|failed> | email-mode <accepted|failed|unknown> | run-worker <moderation|email>'
const moderationModes = new Set(['approve', 'review', 'failed'])
const emailModes = new Set(['accepted', 'failed', 'unknown'])
const moderationDispositions = new Set(['applied', 'already_applied', 'superseded'])
const emailWorkerStates = new Set(['idle', 'processed', 'unavailable'])

function requireCondition(value, message) {
  if (!value) throw new Error(message)
}

function parseCommand(arguments_) {
  const [action, value, ...extra] = arguments_
  if (extra.length || action === undefined) throw new Error(usage)
  if (action === 'state' && value === undefined) return { action }
  if (action === 'moderation-mode' && moderationModes.has(value)) return { action, mode: value }
  if (action === 'email-mode' && emailModes.has(value)) return { action, mode: value }
  if (action === 'run-worker' && value === 'moderation') return { action, name: 'moderate-event-queue' }
  if (action === 'run-worker' && value === 'email') return { action, name: 'ticket-email-worker' }
  throw new Error(usage)
}

function validateRunningProof(proof) {
  requireCondition(proof && typeof proof === 'object' && proof.task === 'spec14-final-assembly', 'Wrong live task proof')
  requireCondition(proof.application === harness.origin, 'Live task proof has the wrong application')
  requireCondition(Array.isArray(proof.processes) && proof.processes.join(',') === 'app,bridge,edge', 'Live task proof has incomplete servers')
  requireCondition(typeof proof.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(proof.sourceSha256), 'Live task proof has no source identity')
  requireCondition(typeof proof.assetsSha256 === 'string' && /^[a-f0-9]{64}$/.test(proof.assetsSha256), 'Live task proof has no asset identity')
  return { task: proof.task }
}

async function verifyRunningTask() {
  const output = execFileSync('python3', [path.join(root, 'tests/integration/spec14-local.py'), 'verify-running'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: 30_000,
  })
  return validateRunningProof(JSON.parse(output.trim()))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unavailable() {
  throw new Error('Control response unavailable')
}

function summarizeResult(command, response) {
  if (!isObject(response)) return unavailable()
  if (command.action === 'state') {
    const email = response.email
    const moderation = response.moderation
    if (!isObject(email) || !emailModes.has(email.mode) || !Array.isArray(email.messages) ||
      !isObject(moderation) || !moderationModes.has(moderation.mode) || !Array.isArray(moderation.requests)) return unavailable()
    return {
      action: 'state',
      email: { messageCount: email.messages.length, mode: email.mode },
      moderation: { mode: moderation.mode, requestCount: moderation.requests.length },
    }
  }
  if (command.action === 'moderation-mode' || command.action === 'email-mode') {
    if (response.outcome !== 'configured' || response.mode !== command.mode) return unavailable()
    return { action: command.action, mode: command.mode, outcome: 'configured' }
  }
  if (command.action === 'run-worker') {
    if (response.outcome !== 'invoked' || response.name !== command.name ||
      !Number.isInteger(response.handlerStatus) || response.handlerStatus < 200 || response.handlerStatus > 299) return unavailable()
    if (command.name === 'ticket-email-worker') {
      if (!isObject(response.body) || !emailWorkerStates.has(response.body.state)) return unavailable()
      return { action: 'run-worker', handlerStatus: response.handlerStatus, name: command.name, workerStatus: response.body.state }
    }
    if (response.handlerStatus === 204 && response.body === null) {
      return { action: 'run-worker', handlerStatus: 204, name: command.name, workerStatus: 'idle' }
    }
    if (!isObject(response.body) || response.body.status !== 'processed' || !moderationDispositions.has(response.body.disposition)) return unavailable()
    return { action: 'run-worker', disposition: response.body.disposition, handlerStatus: response.handlerStatus, name: command.name, workerStatus: 'processed' }
  }
  return unavailable()
}

async function execute(command, dependencies = {}) {
  const verifyRunning = dependencies.verifyRunning || verifyRunningTask
  const invokeControl = dependencies.invokeControl || harness.control
  const identity = await verifyRunning()
  const result = summarizeResult(command, await invokeControl(command))
  return { task: identity.task, ...result }
}

module.exports = { execute, parseCommand, summarizeResult, validateRunningProof, verifyRunningTask }

if (require.main === module) {
  let command
  try {
    command = parseCommand(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : usage)
    process.exitCode = 2
  }
  if (command) execute(command).then(result => {
    console.log(JSON.stringify(result))
  }).catch(error => {
    console.error('Spec14 control failed: ' + (error instanceof Error ? error.name : 'Unknown error'))
    process.exitCode = 1
  })
}
