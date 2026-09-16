-- Facts are private immutable observations, independent of moderation revisions.
-- The original RPC algorithms remain intact behind completed-operation facades.
create table private.event_change_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  snapshot_version bigint generated always as identity unique,
  event_id uuid not null references public.events(id) on delete restrict,
  content_revision bigint not null check (content_revision > 0),
  captured_at timestamptz not null default clock_timestamp(),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  unique(event_id,snapshot_id)
);
create index event_change_snapshots_event_version_idx on private.event_change_snapshots(event_id,snapshot_version desc);
create table private.event_change_state (
  event_id uuid primary key references public.events(id) on delete restrict,
  current_saved_snapshot_id uuid not null,
  previous_saved_snapshot_id uuid,
  current_public_snapshot_id uuid,
  previous_public_snapshot_id uuid,
  notice_required boolean not null default false,
  required_snapshot_id uuid,
  required_fields text[] not null default '{}',
  foreign key(event_id,current_saved_snapshot_id) references private.event_change_snapshots(event_id,snapshot_id),
  foreign key(event_id,previous_saved_snapshot_id) references private.event_change_snapshots(event_id,snapshot_id),
  foreign key(event_id,current_public_snapshot_id) references private.event_change_snapshots(event_id,snapshot_id),
  foreign key(event_id,previous_public_snapshot_id) references private.event_change_snapshots(event_id,snapshot_id),
  foreign key(event_id,required_snapshot_id) references private.event_change_snapshots(event_id,snapshot_id),
  check (notice_required = (required_snapshot_id is not null)),
  check (notice_required or cardinality(required_fields)=0)
);
alter table private.event_change_snapshots enable row level security;
alter table private.event_change_state enable row level security;
revoke all on private.event_change_snapshots,private.event_change_state from public,anon,authenticated,service_role;
revoke all on sequence private.event_change_snapshots_snapshot_version_seq from public,anon,authenticated,service_role;

create function private.guard_event_change_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception using errcode='P0001',message='EVENT_SNAPSHOT_IMMUTABLE';
end;
$$;
create trigger event_change_snapshots_immutable before update or delete on private.event_change_snapshots
for each row execute function private.guard_event_change_snapshot();

create function private.event_change_facts(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select (select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(e)) x(k,v)
   where k=any(array['title','description','category','starts_at','ends_at','timezone','venue_name',
   'address_line1','address_line2','city','region','postal_code','country_code','mapbox_feature_id',
   'latitude','longitude','admission_type','capacity']))
 ||jsonb_build_object('disclosures',(select to_jsonb(d)-array['event_id','created_at','updated_at']
 from private.event_risk_disclosures d where d.event_id=e.id))
 from public.events e where e.id=p_event_id;
$$;

create function private.event_material_change_fields(p_before jsonb,p_after jsonb) returns text[]
language sql immutable set search_path='' as $$
 select coalesce(array_agg(k order by k),'{}'::text[]) from unnest(array[
 'starts_at','ends_at','timezone','venue_name','address_line1','address_line2','city','region','postal_code',
 'country_code','latitude','longitude','admission_type','disclosures']) as fields(k)
 where case when k=any(array['venue_name','address_line1','address_line2','city','region','postal_code','country_code'])
 then lower(regexp_replace(btrim(coalesce(p_before->>k,'')),'\s+',' ','g')) is distinct from
      lower(regexp_replace(btrim(coalesce(p_after->>k,'')),'\s+',' ','g'))
 else p_before->k is distinct from p_after->k end;
$$;

-- Entry points acquire source-row locks before touching snapshot state. The
-- deferred hooks already run beneath source-row locks and must never acquire
-- the ticketing advisory lock in reverse order.
create function private.lock_event_change_rows(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_event_ticketing_operation(p_event_id);
 perform t.id from public.ticket_tiers t where t.event_id=p_event_id order by t.id for update;
 -- A concurrent disclosure update may still need the event FK key-share lock
 -- while its deferred capture commits. NO KEY UPDATE permits that FK check.
 perform e.id from public.events e where e.id=p_event_id for no key update;
 perform d.event_id from private.event_risk_disclosures d where d.event_id=p_event_id for update;
end;
$$;

create function private.capture_event_change_facts(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
 s private.event_change_state%rowtype; v_facts jsonb; v_previous jsonb;
 v_revision bigint; v_id uuid; v_changed text[]; v_eligible boolean; v_was_public boolean;
begin
 -- Snapshot insertion needs an event FK KEY SHARE lock. Acquire it before
 -- history state so canonical cancellation's event FOR UPDATE can finish its
 -- own deferred capture while a direct disclosure mutation waits here.
 perform e.id from public.events e where e.id=p_event_id for key share;
 -- Serialize observations before reading facts so a deferred direct mutation
 -- waiting behind another observation sees the committed complete predecessor.
 select * into s from private.event_change_state where event_id=p_event_id for update;
 select private.event_change_facts(e.id),e.content_revision,
 private.event_is_publicly_eligible(e.id,clock_timestamp()),
 e.public_history_status='previously_public' or e.first_publicly_eligible_at is not null
 into v_facts,v_revision,v_eligible,v_was_public
 from public.events e where e.id=p_event_id;
 if not found then return; end if;
 if s.event_id is null then
   insert into private.event_change_snapshots(event_id,content_revision,facts)
   values(p_event_id,v_revision,v_facts) returning snapshot_id into v_id;
   insert into private.event_change_state(event_id,current_saved_snapshot_id,current_public_snapshot_id)
   values(p_event_id,v_id,case when v_eligible then v_id end);
   return;
 end if;
 select facts into v_previous from private.event_change_snapshots where snapshot_id=s.current_saved_snapshot_id;
 v_id:=s.current_saved_snapshot_id;
 if v_facts is distinct from v_previous then
   insert into private.event_change_snapshots(event_id,content_revision,facts)
   values(p_event_id,v_revision,v_facts) returning snapshot_id into v_id;
   v_changed:=private.event_material_change_fields(v_previous,v_facts);
   -- Canonical exposure survives legacy migration even when immutable public
   -- facts are unavailable. Never equate missing snapshots with never public.
   if (v_was_public or s.current_public_snapshot_id is not null) and cardinality(v_changed)>0 then
     s.notice_required:=true;
     select array_agg(distinct f order by f) into s.required_fields from unnest(s.required_fields||v_changed) f;
   end if;
   update private.event_change_state set previous_saved_snapshot_id=s.current_saved_snapshot_id,
     current_saved_snapshot_id=v_id,notice_required=s.notice_required,
     required_snapshot_id=case when s.notice_required then v_id end,required_fields=s.required_fields
   where event_id=p_event_id;
 end if;
 if v_eligible and s.current_public_snapshot_id is distinct from v_id then
   update private.event_change_state set previous_public_snapshot_id=s.current_public_snapshot_id,
     current_public_snapshot_id=v_id where event_id=p_event_id;
 end if;
end;
$$;

-- Deferred fallback sees the final transaction state after revision invalidation
-- and eligibility triggers. It does not submit notices or call cancellation.
create function private.capture_deferred_event_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='events' then
   perform private.capture_event_change_facts(new.id);
 else
   perform private.capture_event_change_facts(coalesce(new.event_id,old.event_id));
 end if;
 return null;
end;
$$;
create constraint trigger event_change_events_final after insert or update on public.events
 deferrable initially deferred for each row execute function private.capture_deferred_event_change();
create constraint trigger event_change_disclosures_final after insert or update or delete on private.event_risk_disclosures
 deferrable initially deferred for each row execute function private.capture_deferred_event_change();

create function private.event_change_context_token(p_event_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object(
 'event',to_jsonb(e)-'updated_at',
 'snapshot_id',(select current_saved_snapshot_id from private.event_change_state where event_id=e.id),
 'facts',private.event_change_facts(e.id),
 'organizer',(select to_jsonb(o)-array['created_at','updated_at'] from public.organizers o where o.id=e.organizer_id),
 'tiers',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'unit_amount_minor',t.unit_amount_minor,
    'currency',t.currency,'quantity_total',t.quantity_total,'status',t.status,'sort_order',t.sort_order) order by t.id),'[]') from public.ticket_tiers t where t.event_id=e.id),
 'policy_requirements',(select jsonb_agg(to_jsonb(r) order by r.policy_kind) from private.organizer_policy_requirements r),
 'policy_release',(select jsonb_agg(to_jsonb(r)) from private.organizer_policy_release_settings r),
 'acceptances',(select jsonb_agg(a.id order by a.id) from private.event_policy_acceptances a where a.event_id=e.id),
 'eligible',private.event_is_publicly_eligible(e.id,statement_timestamp())
 )::text,'sha256'),'hex') from public.events e where e.id=p_event_id;
$$;

create function private.lock_owned_event_change_context(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.events where id=p_event_id and organizer_id=auth.uid()) then
   raise exception using errcode='P0001',message='EVENT_NOT_FOUND';
 end if;
 perform private.lock_event_change_rows(p_event_id);
 -- Follow the existing policy reader/configurer row-lock order. Table SHARE
 -- would block configure_policy_environment's later UPDATE lock upgrade.
 perform o.id from public.organizers o join public.events e on e.organizer_id=o.id
 where e.id=p_event_id for share of o;
 perform r.singleton_id from private.organizer_policy_release_settings r where r.singleton_id for share;
 perform r.policy_kind from private.organizer_policy_requirements r
 join private.organizer_policy_versions v on v.policy_kind=r.policy_kind and v.id=r.policy_version_id
 order by r.policy_kind for share of r,v;
 if not exists(select 1 from public.events where id=p_event_id and organizer_id=auth.uid()) then
   raise exception using errcode='P0001',message='EVENT_NOT_FOUND';
 end if;
end;
$$;
create function private.assert_event_change_context(p_event_id uuid,p_expected_context text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_owned_event_change_context(p_event_id);
 if p_expected_context is null or p_expected_context is distinct from private.event_change_context_token(p_event_id) then
   raise exception using errcode='P0001',message='EVENT_CONTEXT_CONFLICT';
 end if;
end;
$$;
create function public.get_owned_event_change_context(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.lock_owned_event_change_context(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 select jsonb_build_object('event_id',s.event_id,
 'event',(select to_jsonb(e) from public.events e where e.id=s.event_id),
 'requirements',(select to_jsonb(r) from public.get_owned_event_requirements(s.event_id) r),
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

-- Internal notice submission may clear only the exact current eligible facts.
-- No execute grant is given to any API role; a later deliberate server writer
-- must enforce owner, audience, idempotency and durable submission itself.
create function private.mark_event_change_notice_submitted(p_event_id uuid,p_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_event_change_rows(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 if p_snapshot_id is null or not exists(select 1 from private.event_change_state s where s.event_id=p_event_id
   and s.current_saved_snapshot_id=p_snapshot_id and s.current_public_snapshot_id=p_snapshot_id
   and private.event_is_publicly_eligible(p_event_id,clock_timestamp())) then
   raise exception using errcode='P0001',message='EVENT_CONTEXT_CONFLICT';
 end if;
 update private.event_change_state set notice_required=false,required_snapshot_id=null,required_fields='{}' where event_id=p_event_id;
end;
$$;

alter function public.save_owned_event_revision(uuid,jsonb) rename to save_owned_event_revision_without_change_history;
revoke all on function public.save_owned_event_revision_without_change_history(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.save_owned_event_revision(p_event_id uuid,p_event jsonb) returns public.events
language plpgsql security definer set search_path='' as $$
declare v_result public.events;
begin
 perform private.lock_owned_event_change_context(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 v_result:= public.save_owned_event_revision_without_change_history(p_event_id,p_event);
 perform private.capture_event_change_facts(p_event_id);
 return v_result;
end;
$$;
create function public.save_owned_event_revision_if_current(p_event_id uuid,p_event jsonb,p_expected_context text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.assert_event_change_context(p_event_id,p_expected_context);
 select to_jsonb(r) into v_result from public.save_owned_event_revision(p_event_id,p_event) r;
 return jsonb_build_object('result',v_result,'context',public.get_owned_event_change_context(p_event_id));
end;
$$;
revoke all on function public.save_owned_event_revision(uuid,jsonb),public.save_owned_event_revision_if_current(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.save_owned_event_revision(uuid,jsonb),public.save_owned_event_revision_if_current(uuid,jsonb,text) to authenticated;

alter function public.save_owned_event_requirements(uuid,jsonb) rename to save_owned_event_requirements_without_change_history;
revoke all on function public.save_owned_event_requirements_without_change_history(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.save_owned_event_requirements(p_event_id uuid,p_requirements jsonb) returns table (minimum_age text,alcohol_present boolean,cannabis_present boolean,explicit_adult_content boolean,gambling_present boolean,weapons_present boolean,high_risk_activity boolean)
language plpgsql security definer set search_path='' as $$

begin
 perform private.lock_owned_event_change_context(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 return query select * from public.save_owned_event_requirements_without_change_history(p_event_id,p_requirements);
 perform private.capture_event_change_facts(p_event_id);

end;
$$;
create function public.save_owned_event_requirements_if_current(p_event_id uuid,p_requirements jsonb,p_expected_context text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.assert_event_change_context(p_event_id,p_expected_context);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_result from public.save_owned_event_requirements(p_event_id,p_requirements) r;
 return jsonb_build_object('result',v_result,'context',public.get_owned_event_change_context(p_event_id));
end;
$$;
revoke all on function public.save_owned_event_requirements(uuid,jsonb),public.save_owned_event_requirements_if_current(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.save_owned_event_requirements(uuid,jsonb),public.save_owned_event_requirements_if_current(uuid,jsonb,text) to authenticated;

alter function public.accept_current_event_policies(uuid) rename to accept_current_event_policies_without_change_history;
revoke all on function public.accept_current_event_policies_without_change_history(uuid) from public,anon,authenticated,service_role;
create function public.accept_current_event_policies(p_event_id uuid) returns table (minimum_age text,alcohol_present boolean,cannabis_present boolean,explicit_adult_content boolean,gambling_present boolean,weapons_present boolean,high_risk_activity boolean,needs_acceptance boolean,organizer_terms_label text,organizer_terms_version_id text,organizer_terms_stage text,organizer_terms_url text,event_policy_label text,event_policy_version_id text,event_policy_stage text,event_policy_url text)
language plpgsql security definer set search_path='' as $$

begin
 perform private.lock_owned_event_change_context(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 return query select * from public.accept_current_event_policies_without_change_history(p_event_id);
 perform private.capture_event_change_facts(p_event_id);

end;
$$;
create function public.accept_current_event_policies_if_current(p_event_id uuid,p_expected_context text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.assert_event_change_context(p_event_id,p_expected_context);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_result from public.accept_current_event_policies(p_event_id) r;
 return jsonb_build_object('result',v_result,'context',public.get_owned_event_change_context(p_event_id));
end;
$$;
revoke all on function public.accept_current_event_policies(uuid),public.accept_current_event_policies_if_current(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.accept_current_event_policies(uuid),public.accept_current_event_policies_if_current(uuid,text) to authenticated;

alter function public.publish_event(uuid) rename to publish_event_without_change_history;
revoke all on function public.publish_event_without_change_history(uuid) from public,anon,authenticated,service_role;
create function public.publish_event(p_event_id uuid) returns public.events
language plpgsql security definer set search_path='' as $$
declare v_result public.events;
begin
 perform private.lock_owned_event_change_context(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 v_result:= public.publish_event_without_change_history(p_event_id);
 perform private.capture_event_change_facts(p_event_id);
 return v_result;
end;
$$;
create function public.publish_event_if_current(p_event_id uuid,p_expected_context text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform private.assert_event_change_context(p_event_id,p_expected_context);
 select to_jsonb(r) into v_result from public.publish_event(p_event_id) r;
 return jsonb_build_object('result',v_result,'context',public.get_owned_event_change_context(p_event_id));
end;
$$;
revoke all on function public.publish_event(uuid),public.publish_event_if_current(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_event(uuid),public.publish_event_if_current(uuid,text) to authenticated;

revoke all on function private.guard_event_change_snapshot(),private.event_change_facts(uuid),
 private.event_material_change_fields(jsonb,jsonb),private.capture_event_change_facts(uuid),
 private.capture_deferred_event_change(),private.event_change_context_token(uuid),
 private.lock_event_change_rows(uuid),private.lock_owned_event_change_context(uuid),private.assert_event_change_context(uuid,text),
 private.mark_event_change_notice_submitted(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_event_change_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_event_change_context(uuid) to authenticated;

-- Migration can prove only the current state. It never fabricates a prior
-- saved/public version from the mutable row or old content_revision numbers.
do $$
declare v_event_id uuid;
begin
 for v_event_id in select id from public.events order by id loop
   perform private.lock_event_change_rows(v_event_id);
   perform private.capture_event_change_facts(v_event_id);
 end loop;
end;
$$;
