import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const databaseUrl = process.env.WHERETO_TICKETING_DB_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Lite cleanup test requires an explicit disposable loopback database')
  }
}

describe.skipIf(!databaseUrl)('Lite auxiliary cleanup against real local constraints', () => {
  for (const scenario of ['safe', 'partial_auth', 'wrong_identity', 'unexpected_history', 'missing_interval'] as const) {
    it(`handles ${scenario} without touching the audited main event`, () => {
      const prefix = `task17_${randomBytes(6).toString('hex')}`
      const owner = randomUUID(), other = randomUUID(), event = randomUUID(), main = randomUUID()
      const setup = `begin;
        insert into auth.users(id,email) values ('${owner}','${prefix}@example.invalid'),('${other}','${prefix}-admission@example.invalid');
        insert into public.organizers(id,display_name) values ('${owner}','${prefix}');
        insert into public.events(id,organizer_id,title) values ('${main}','${owner}','${prefix} transaction');
        ${scenario === 'partial_auth' ? '' : `insert into public.organizers(id,display_name) values ('${other}','${prefix} admission');
          insert into public.events(id,organizer_id,title) values ('${event}','${owner}','${prefix} wrong-event');`}
        ${scenario === 'wrong_identity' ? `update auth.users set email='unrelated@example.invalid' where id='${owner}';` : ''}
        ${scenario === 'unexpected_history' ? `update public.events set public_history_status='previously_public',first_publicly_eligible_at=statement_timestamp() where id='${event}';` : ''}
        ${scenario === 'missing_interval' ? `set local session_replication_role=replica; delete from private.event_public_eligibility_intervals where event_id='${event}'; set local session_replication_role=origin;` : ''}
      `
      const cleanup = readFileSync('tests/integration/sql/core-ticket-lite-cleanup-auxiliary.sql', 'utf8')
        .replace(/^begin;/, '').replace(/commit;\s*$/, '').replaceAll('__TASK17_FIXTURE_PREFIX__', prefix)
      const verify = `select case when
        (select count(*) from public.events where id='${main}')=1 and
        (select count(*) from private.event_public_eligibility_intervals where event_id='${main}')=1 and
        (select count(*) from public.events where id='${event}')=0 and
        (select count(*) from public.organizers where id='${other}')=0
        then 'cleanup_ok' else 'cleanup_failed' end; rollback;`
      const result = spawnSync('psql', [databaseUrl!, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
        input: setup + cleanup + verify, encoding: 'utf8', timeout: 30_000,
      })
      if (scenario === 'safe' || scenario === 'partial_auth') {
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('cleanup_ok')
      } else {
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('LITE_AUX_CLEANUP_UNSAFE')
      }
    })
  }
})
