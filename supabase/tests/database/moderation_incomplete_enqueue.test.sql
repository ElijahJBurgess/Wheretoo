-- Own-fixture regression: safe to run before or after the forward migration.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

insert into auth.users (id, email)
values ('18000000-0000-4000-8000-000000000141', 'incomplete-moderation-regression@example.invalid');
insert into public.organizers (id, display_name)
values ('18000000-0000-4000-8000-000000000141', 'Incomplete moderation regression');
insert into public.events (id, organizer_id, admission_type)
values ('28000000-0000-4000-8000-000000000141', '18000000-0000-4000-8000-000000000141', 'paid');

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000141', true);
set local role authenticated;
select lives_ok($$
  select public.save_ticket_tiers(
    '28000000-0000-4000-8000-000000000141',
    '[{"name":"Early admission","description":"Public tier copy before disclosures","unit_amount_minor":2500,"currency":"usd","quantity_total":20,"sort_order":1}]'::jsonb
  )
$$, 'public tier text can be saved before disclosures');
reset role;

select results_eq($$
  select content_revision, moderation_version, moderation_status
  from public.events where id = '28000000-0000-4000-8000-000000000141'
$$, $$ values (2::bigint, 1::bigint, 'under_review'::text) $$,
  'the incomplete draft still advances revision and moderation version');

select results_eq($$
  select count(*)::bigint from private.event_moderation_evaluations
  where event_id = '28000000-0000-4000-8000-000000000141'
$$, $$ values (0::bigint) $$,
  'missing disclosures do not enqueue malformed contextual work');

select results_eq($$
  select actions.content_revision, actions.previous_content_revision,
    actions.input_sha256 = private.compute_event_input_sha256(actions.event_id),
    actions.evaluation_id is null
  from private.event_moderation_actions as actions
  where actions.event_id = '28000000-0000-4000-8000-000000000141'
    and actions.source = 'edit'
$$, $$ values (2::bigint, 1::bigint, true, true) $$,
  'the immutable edit action keeps the real revision/hash without a placeholder evaluation');

select * from finish();
rollback;
