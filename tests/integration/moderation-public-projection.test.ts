import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const supabaseCli = path.join(repositoryRoot, 'node_modules/.bin/supabase')

async function linkedQuery(sql: string) {
  return execFileAsync(supabaseCli, ['db', 'query', '--linked', sql], {
    cwd: repositoryRoot,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
  })
}

describe('moderation public projection and RLS boundary', () => {
  it('hides an ineligible event immediately while retaining owner records', async () => {
    const ownerId = randomUUID()
    const otherOwnerId = randomUUID()
    const staffId = randomUUID()
    const eventId = randomUUID()
    const runId = randomUUID().replaceAll('-', '')

    const proof = await linkedQuery(`
      begin;

      insert into auth.users (id, email) values
        ('${ownerId}', 'whereto-task15-owner-${runId}@example.invalid'),
        ('${otherOwnerId}', 'whereto-task15-other-${runId}@example.invalid'),
        ('${staffId}', 'whereto-task15-staff-${runId}@example.invalid');

      insert into private.staff_roles (user_id, role, active, granted_by)
      values ('${staffId}', 'moderator', true, '${staffId}');

      insert into public.organizers (
        id, display_name, organizer_type, bio, website_url, base_city,
        country_code, onboarding_completed_at
      ) values (
        '${ownerId}', 'WHERETO_TASK15_${runId}', 'Community group',
        'private biography', 'https://private.example.invalid',
        'Private Base City', 'US', statement_timestamp()
      );

      insert into public.events (
        id, organizer_id, title, description, category, starts_at, ends_at,
        timezone, venue_name, address_line1, city, region, postal_code,
        country_code, mapbox_feature_id, latitude, longitude, admission_type,
        capacity
      ) values (
        '${eventId}', '${ownerId}', 'WHERETO_TASK15_${runId}',
        'A complete low-risk event used for the Task 15 projection proof.',
        'community', statement_timestamp() + interval '2 days',
        statement_timestamp() + interval '2 days 2 hours',
        'America/Los_Angeles', 'Task 15 Hall', '1 Market Street',
        'San Francisco', 'CA', '94105', 'US',
        'mapbox.task15.${runId}', 37.7936, -122.3958, 'free', 40
      );

      insert into private.event_risk_disclosures (
        event_id, minimum_age, alcohol_present, cannabis_present,
        explicit_adult_content, gambling_present, weapons_present,
        high_risk_activity
      ) values (
        '${eventId}', 'all_ages', false, false, false, false, false, false
      );

      select set_config('request.jwt.claim.sub', '${ownerId}', true);
      set local role authenticated;
      select public.accept_current_event_policies('${eventId}');
      select public.publish_event('${eventId}');
      reset role;

      do $assert$
      declare projection jsonb;
      begin
        select value into projection from public.get_public_event('${eventId}') as value;
        if projection is null
           or not projection ?& array[
             'id', 'title', 'description', 'category', 'starts_at', 'ends_at',
             'timezone', 'venue_name', 'city', 'region', 'country_code',
             'latitude', 'longitude', 'admission_type', 'minimum_age',
             'advisories', 'organizer'
           ]
           or projection ?| array[
             'organizer_id', 'moderation_status', 'moderation_version',
             'content_revision', 'public_history_status', 'capacity',
             'mapbox_feature_id'
           ]
           or projection->'organizer' ?| array['bio', 'website_url', 'base_city'] then
          raise exception using errcode = 'P0001', message = 'ASSERT_SAFE_PUBLIC_PROJECTION';
        end if;
        if pg_catalog.has_table_privilege('anon', 'public.events', 'select')
           or pg_catalog.has_table_privilege('anon', 'public.organizers', 'select')
           or pg_catalog.has_table_privilege('authenticated', 'private.event_moderation_actions', 'select') then
          raise exception using errcode = 'P0001', message = 'ASSERT_BASE_TABLE_OR_PRIVATE_ACL';
        end if;
      end
      $assert$;

      select set_config('request.jwt.claim.sub', '${ownerId}', true);
      set local role authenticated;
      do $assert$
      begin
        if (select count(*) from public.events where id = '${eventId}') <> 1 then
          raise exception using errcode = 'P0001', message = 'ASSERT_OWNER_RLS_READ';
        end if;
      end
      $assert$;
      reset role;

      select set_config('request.jwt.claim.sub', '${otherOwnerId}', true);
      set local role authenticated;
      do $assert$
      begin
        if (select count(*) from public.events where id = '${eventId}') <> 0 then
          raise exception using errcode = 'P0001', message = 'ASSERT_CROSS_OWNER_RLS_DENIAL';
        end if;
      end
      $assert$;
      reset role;

      select set_config('request.jwt.claim.sub', '${staffId}', true);
      set local role authenticated;
      select public.moderate_event(
        '${eventId}', moderation_case.content_revision,
        moderation_case.input_sha256, moderation_case.moderation_version,
        'remove', 'other', 'Task 15 immediate projection proof'
      )
      from public.get_moderation_case('${eventId}') as moderation_case;
      reset role;

      do $assert$
      begin
        if exists (select 1 from public.get_public_event('${eventId}')) then
          raise exception using errcode = 'P0001', message = 'ASSERT_REMOVAL_NOT_IMMEDIATE';
        end if;
        if not exists (
          select 1 from public.events
          where id = '${eventId}' and status = 'published'
            and moderation_status = 'removed'
            and public_history_status = 'previously_public'
        ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_OWNER_RECORD_NOT_RETAINED';
        end if;
      end
      $assert$;

      rollback;
    `)

    expect(proof.stderr).not.toMatch(/ASSERT_[A-Z0-9_]+/)

    const residue = await linkedQuery(`
      do $assert$
      begin
        if exists (select 1 from auth.users where id in ('${ownerId}', '${otherOwnerId}', '${staffId}'))
           or exists (select 1 from public.events where id = '${eventId}') then
          raise exception using errcode = 'P0001', message = 'ASSERT_TASK15_PROJECTION_RESIDUE';
        end if;
      end
      $assert$;
    `)
    expect(residue.stderr).not.toMatch(/ASSERT_[A-Z0-9_]+/)
  }, 120_000)
})
