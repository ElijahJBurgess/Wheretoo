import { demoEmail, demoEvents, demoOrganizerId, demoOrganizerName, demoTiers } from '../../src/preview/devWorldCatalog'

export function assertDevelopmentTarget(input: { projectRef: string; url: string; key: string; environment: string; connectedAccount: string }) {
  if (!/^[a-z]{20}$/.test(input.projectRef) || input.url !== `https://${input.projectRef}.supabase.co` ||
    !input.key.startsWith('pk_test_') || input.environment !== 'development' || !/^acct_[A-Za-z0-9]+$/.test(input.connectedAccount)) {
    throw new Error('WORLD_REQUIRES_LINKED_DEVELOPMENT_AND_STRIPE_TEST')
  }
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`

export function renderSeedSql(account: string, mode: 'seed' | 'reset') {
  if (!/^acct_[A-Za-z0-9]+$/.test(account)) throw new Error('WORLD_ACCOUNT_INVALID')
  const catalog = demoEvents.map((e, index) => ({ ...e, offset: index + 2 }))
  return `begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(260908, 1);
do $world$
declare
  e jsonb; t jsonb; current_event public.events%rowtype; payload jsonb;
  evaluation private.event_moderation_evaluations%rowtype;
  target_quantity integer;
begin
  if not exists (select 1 from private.organizer_policy_release_settings where environment = 'development') then
    raise exception 'WORLD_PRODUCTION_FORBIDDEN';
  end if;
  if exists (select 1 from auth.users where (id = '${demoOrganizerId}' and email <> '${demoEmail}') or (email = '${demoEmail}' and id <> '${demoOrganizerId}'))
    or exists (select 1 from public.organizers where id = '${demoOrganizerId}' and display_name <> ${literal(demoOrganizerName)})
    or exists (select 1 from private.staff_roles where user_id = '${demoOrganizerId}') then
    raise exception 'WORLD_IDENTITY_CONFLICT';
  end if;
  -- No usable password or organizer login is created. The operator invokes owner RPCs in this transaction.
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('${demoOrganizerId}', 'authenticated', 'authenticated', '${demoEmail}', '', now(), 'infinity', '{"provider":"email","providers":["email"]}', '{"fixture":"wheretoo-dev-world-v1"}', now(), now()) on conflict (id) do nothing;
  if not exists (select 1 from auth.users where id = '${demoOrganizerId}' and raw_user_meta_data->>'fixture' = 'wheretoo-dev-world-v1' and banned_until > now()) then raise exception 'WORLD_IDENTITY_CONFLICT'; end if;
  insert into public.organizers (id, display_name, bio, base_city)
    values ('${demoOrganizerId}', ${literal(demoOrganizerName)}, 'Fictional development organizer. Stripe TEST only.', 'Oakland') on conflict (id) do nothing;
  if exists (select 1 from public.organizer_stripe_accounts where (stripe_account_id = ${literal(account)} and organizer_id <> '${demoOrganizerId}') or (organizer_id = '${demoOrganizerId}' and (stripe_account_id <> ${literal(account)} or livemode))) then raise exception 'WORLD_ACCOUNT_ALREADY_BOUND'; end if;
  -- These statuses are written only after the remote probe validates the actual account with the existing Connect validator.
  insert into public.organizer_stripe_accounts (organizer_id, stripe_account_id, transfers_status, payouts_status, requirements_status, requirements_currently_due_count, requirements_past_due_count, last_status_code, last_synced_at, livemode)
    values ('${demoOrganizerId}', ${literal(account)}, 'active', 'active', 'clear', 0, 0, 'READY', now(), false)
    on conflict (organizer_id, livemode) do update set last_synced_at = now(), transfers_status = 'active', payouts_status = 'active', requirements_status = 'clear', requirements_currently_due_count = 0, requirements_past_due_count = 0;
  perform set_config('request.jwt.claim.sub', '${demoOrganizerId}', true);
  perform set_config('request.jwt.claims', '{"sub":"${demoOrganizerId}","role":"authenticated"}', true);
  for e in select value from jsonb_array_elements(${literal(JSON.stringify(catalog))}::jsonb) loop
    perform public.lock_event_ticketing_operation((e->>'id')::uuid);
    select * into current_event from public.events where id = (e->>'id')::uuid for update;
    if found and (current_event.organizer_id <> '${demoOrganizerId}' or current_event.mapbox_feature_id <> 'wheretoo-dev-world-v1:' || (e->>'id') or current_event.title <> e->>'title' or current_event.description <> e->>'description') then raise exception 'WORLD_IDENTITY_CONFLICT'; end if;
    if current_event.status = 'cancelled' then raise exception 'WORLD_CANCELLED_EVENT_REQUIRES_REVIEW'; end if;
    payload := jsonb_build_object('title', e->>'title', 'description', e->>'description', 'category', e->>'category',
      'starts_at', date_trunc('day', now()) + (e->>'offset')::integer * interval '1 day' + interval '2 hours',
      'ends_at', date_trunc('day', now()) + (e->>'offset')::integer * interval '1 day' + interval '6 hours',
      'timezone', 'America/Los_Angeles', 'venue_name', e->>'venue', 'address_line1', e->>'address', 'address_line2', null,
      'city', e->>'city', 'region', 'CA', 'postal_code', e->>'postal', 'country_code', 'US',
      'mapbox_feature_id', 'wheretoo-dev-world-v1:' || (e->>'id'), 'latitude', (e->>'latitude')::float8, 'longitude', (e->>'longitude')::float8,
      'admission_type', case when (e->>'paid')::boolean then 'paid' else 'free' end, 'capacity', 1000);
    if current_event.id is null then
      insert into public.events (id, organizer_id, status, moderation_status) values ((e->>'id')::uuid, '${demoOrganizerId}', 'draft', 'not_evaluated');
      perform public.save_owned_event_revision((e->>'id')::uuid, payload);
    elsif current_event.starts_at < now() + interval '1 day' then
      -- Preserve previous orders and their snapshots. Refresh an aging development event through the normal revision path.
      perform public.save_owned_event_revision((e->>'id')::uuid, payload);
    end if;
    if (e->>'paid')::boolean then
      if exists (select 1 from public.ticket_tiers where event_id = (e->>'id')::uuid and id not in ('${demoTiers[0].id}', '${demoTiers[1].id}')) then raise exception 'WORLD_UNEXPECTED_TIER'; end if;
      for t in select value from jsonb_array_elements(${literal(JSON.stringify(demoTiers))}::jsonb) loop
        if exists (select 1 from public.ticket_tiers where id = (t->>'id')::uuid and (event_id <> (e->>'id')::uuid or name <> t->>'name' or unit_amount_minor <> (t->>'unit_amount_minor')::bigint or currency <> 'usd')) then raise exception 'WORLD_IDENTITY_CONFLICT'; end if;
        insert into public.ticket_tiers (id,event_id,name,description,unit_amount_minor,currency,quantity_total,status,sort_order)
          values ((t->>'id')::uuid,(e->>'id')::uuid,t->>'name',t->>'description',(t->>'unit_amount_minor')::bigint,'usd',(t->>'quantity_total')::integer,'draft',(t->>'sort_order')::integer) on conflict (id) do nothing;
        -- Conservative replenishment counts ALL historical quantities, including refunds and expired holds.
        -- No paid/reserved quantity is ever subtracted and no order/ticket is mutated.
        select (t->>'quantity_total')::integer + coalesce(sum(items.quantity),0)::integer into target_quantity from public.order_items items where items.ticket_tier_id = (t->>'id')::uuid;
        if '${mode}' = 'reset' then
          update public.ticket_tiers set quantity_total = greatest(quantity_total, target_quantity) where id = (t->>'id')::uuid;
        end if;
      end loop;
    end if;
    if not exists (select 1 from private.event_risk_disclosures where event_id = (e->>'id')::uuid) then
      perform public.save_owned_event_requirements((e->>'id')::uuid, '{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}'::jsonb);
    end if;
    select * into current_event from public.events where id = (e->>'id')::uuid;
    -- Same exact revision/hash/queue matching as the existing scoped development fixture helper.
    if current_event.moderation_status = 'under_review' then
      select * into strict evaluation from private.event_moderation_evaluations q where q.event_id = current_event.id and q.content_revision = current_event.content_revision and q.input_sha256 = private.compute_event_input_sha256(current_event.id) and q.queued_moderation_version = current_event.moderation_version and q.status = 'queued' and q.source = 'contextual' and q.attempt_count < 3 for update;
      update private.event_moderation_evaluations set status = 'processing', attempt_count = attempt_count + 1, started_at = now(), finished_at = null, failure_code = null where id = evaluation.id;
      if public.server_apply_moderation_evaluation(evaluation.id, evaluation.content_revision, evaluation.input_sha256, evaluation.queued_moderation_version, 'clear_candidate', 'low', array['no_violation']::text[], null, null) <> 'applied' then raise exception 'WORLD_MODERATION_FAILED'; end if;
    end if;
    perform public.accept_current_event_policies((e->>'id')::uuid);
    perform public.publish_event((e->>'id')::uuid);
    if not exists (select 1 from public.get_public_event((e->>'id')::uuid)) then raise exception 'WORLD_EVENT_NOT_PUBLIC'; end if;
  end loop;
  if not exists (select 1 from public.get_public_event_ticketing('${demoEvents[0].id}')) then raise exception 'WORLD_CANONICAL_MISSING'; end if;
  if '${mode}' = 'seed' then
    if exists (select 1 from public.events where organizer_id <> '${demoOrganizerId}' and admission_type = 'paid' and status = 'published' and publicly_authorized_action_id is not null) then raise exception 'WORLD_OTHER_PUBLISHED_PAID_EVENT'; end if;
    update private.checkout_runtime_control set checkout_creation_enabled = true, updated_at = now() where singleton;
  end if;
end $world$;
commit;
select id,title,status from public.events where organizer_id = '${demoOrganizerId}' order by id;`
}
