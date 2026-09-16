begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec10_event_history_setup.inc
reset role;
-- Model migration seeding an already-held historical public event: canonical
-- public-history evidence survives, but no pre-migration public facts exist.
delete from private.event_change_state where event_id='aa200000-0000-4000-8000-000000000001';
update public.events set moderation_status='under_review',moderation_version=moderation_version+1 where id='aa200000-0000-4000-8000-000000000001';
create temp table legacy_context as select public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000001') context;
select is((select context->'current_publicly_eligible' from legacy_context),'null'::jsonb,'held legacy row has no fabricated public facts');
select is((select context->'event'->>'public_history_status' from legacy_context),'previously_public','canonical history proves earlier public exposure');
select ok((select context->'event'->>'first_publicly_eligible_at' is not null from legacy_context),'canonical first-public evidence is present');
grant select on legacy_context to authenticated;
set local role authenticated;
select public.save_owned_event_revision_if_current('aa200000-0000-4000-8000-000000000001',
 ((select context->'current_saved'->'facts' from legacy_context)-'disclosures')||'{"venue_name":"New Community Hall"}',
 (select context->>'context_token' from legacy_context));
select is(public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000001')->>'notice_required','true','material save on previously-public held legacy event requires notice without a public snapshot');
select is(public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000001')->'required_fields','["venue_name"]'::jsonb,'legacy material reason persists independently of unavailable public facts');
select is(public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000001')->'current_publicly_eligible','null'::jsonb,'requiring follow-up does not invent legacy public history');
select * from finish();
rollback;
