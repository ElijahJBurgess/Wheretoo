-- Preserve policy acceptance/publication authorities; only the owner editor read changes.
create or replace function public.get_owned_event_change_context(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_requirements jsonb; v_disclosure private.event_risk_disclosures%rowtype;
begin
 perform private.lock_owned_event_change_context(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 -- Policy readiness gates consent/publication, not authenticated draft editing.
 -- The owner check and context locks above still apply to both projections.
 if exists(select 1 from private.organizer_policy_release_settings where singleton_id and environment='unconfigured') then
   select * into v_disclosure from private.event_risk_disclosures where event_id=p_event_id;
   v_requirements := jsonb_build_object(
     'policies_unavailable',true,'needs_acceptance',true,
     'minimum_age',v_disclosure.minimum_age,
     'alcohol_present',v_disclosure.alcohol_present,
     'cannabis_present',v_disclosure.cannabis_present,
     'explicit_adult_content',v_disclosure.explicit_adult_content,
     'gambling_present',v_disclosure.gambling_present,
     'weapons_present',v_disclosure.weapons_present,
     'high_risk_activity',v_disclosure.high_risk_activity);
 else
   select to_jsonb(r) into v_requirements from public.get_owned_event_requirements(p_event_id) r;
 end if;
 select jsonb_build_object('event_id',s.event_id,
 'event',(select to_jsonb(e) from public.events e where e.id=s.event_id),
 'requirements',v_requirements,
 'context_token',private.event_change_context_token(s.event_id),
 'currently_publicly_eligible',private.event_is_publicly_eligible(s.event_id,clock_timestamp()),
 'previous_saved',to_jsonb(ps)-'event_id','current_saved',to_jsonb(cs)-'event_id',
 'previous_publicly_eligible',to_jsonb(pp)-'event_id','current_publicly_eligible',to_jsonb(cp)-'event_id',
 'notice_required',s.notice_required,'required_snapshot_id',s.required_snapshot_id,'required_fields',to_jsonb(s.required_fields))
 into v_result from private.event_change_state s
 join private.event_change_snapshots cs on cs.snapshot_id=s.current_saved_snapshot_id
 left join private.event_change_snapshots ps on ps.snapshot_id=s.previous_saved_snapshot_id
 left join private.event_change_snapshots cp on cp.snapshot_id=s.current_public_snapshot_id
 left join private.event_change_snapshots pp on pp.snapshot_id=s.previous_public_snapshot_id
 where s.event_id=p_event_id;
 return v_result;
end;
$$;
