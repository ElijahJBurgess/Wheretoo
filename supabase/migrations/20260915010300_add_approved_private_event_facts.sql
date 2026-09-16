-- Existing accountless bearers and immutable admission sources stay intact.
-- Only display facts change: never expose a newer unpublished organizer edit.
create function private.approved_event_ticket_facts(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select s.facts from private.event_change_state h join private.event_change_snapshots s on s.snapshot_id=h.current_public_snapshot_id where h.event_id=p_event_id;
$$;
alter function public.server_lookup_paid_ticket_collection(text) rename to lookup_paid_ticket_collection_before_spec10;
alter function public.lookup_paid_ticket_collection_before_spec10(text) set schema private;
revoke all on function private.lookup_paid_ticket_collection_before_spec10(text) from public,anon,authenticated,service_role;
create function public.server_lookup_paid_ticket_collection(p_confirmation_token_hash text)
returns table(event_id uuid,event_title text,event_starts_at timestamptz,event_ends_at timestamptz,event_venue_name text,event_status text,
 order_status text,quantity integer,items jsonb,tickets jsonb,event_timezone text,event_address text,event_facts_available boolean,event_updated boolean)
language sql stable security definer set search_path='' as $$
 select p.event_id,f.facts->>'title',(f.facts->>'starts_at')::timestamptz,(f.facts->>'ends_at')::timestamptz,f.facts->>'venue_name',p.event_status,p.order_status,p.quantity,p.items,
 (select jsonb_agg(t.value||jsonb_build_object('used_at',original.used_at) order by t.ordinality)
  from jsonb_array_elements(p.tickets) with ordinality t join public.tickets original on original.id=(t.value->>'id')::uuid),
 f.facts->>'timezone',case when f.facts is not null then concat_ws(', ',nullif(f.facts->>'address_line1',''),nullif(f.facts->>'address_line2',''),nullif(f.facts->>'city',''),nullif(f.facts->>'region',''),nullif(f.facts->>'postal_code','')) end,
 f.facts is not null,coalesce((select previous_public_snapshot_id is not null from private.event_change_state where event_id=p.event_id),false)
 from private.lookup_paid_ticket_collection_before_spec10(p_confirmation_token_hash) p
 cross join lateral (select private.approved_event_ticket_facts(p.event_id) facts) f;
$$;
alter function public.server_lookup_free_ticket_collection(text) rename to lookup_free_ticket_collection_before_spec10;
alter function public.lookup_free_ticket_collection_before_spec10(text) set schema private;
revoke all on function private.lookup_free_ticket_collection_before_spec10(text) from public,anon,authenticated,service_role;
create function public.server_lookup_free_ticket_collection(p_access_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p jsonb;facts jsonb;updated boolean;
begin
 p:=private.lookup_free_ticket_collection_before_spec10(p_access_hash);
 if p is null then return null;end if;
 facts:=private.approved_event_ticket_facts((p->>'event_id')::uuid);
 select previous_public_snapshot_id is not null into updated from private.event_change_state where event_id=(p->>'event_id')::uuid;
 return p||jsonb_build_object('event_title',facts->>'title','event_starts_at',facts->>'starts_at','event_ends_at',facts->>'ends_at',
  'event_venue_name',facts->>'venue_name','event_timezone',facts->>'timezone','event_facts_available',facts is not null,'event_updated',coalesce(updated,false),
  'event_address',case when facts is not null then concat_ws(', ',nullif(facts->>'address_line1',''),nullif(facts->>'address_line2',''),nullif(facts->>'city',''),nullif(facts->>'region',''),nullif(facts->>'postal_code','')) end);
end;$$;
revoke all on function private.approved_event_ticket_facts(uuid),public.server_lookup_paid_ticket_collection(text),public.server_lookup_free_ticket_collection(text) from public,anon,authenticated,service_role;
grant execute on function public.server_lookup_paid_ticket_collection(text),public.server_lookup_free_ticket_collection(text) to service_role;

-- The email membership index and selected collection share the same approved facts.
create or replace function public.server_read_ticket_email_access(p_token_hash text,p_ip_hash text,p_page integer default 0,p_member integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ticket_email_grants; m private.ticket_email_members; proof text; projection jsonb; entries jsonb; total integer;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 -- Malformed hashes/selectors still spend aggregate and invalid-IP capacity, with no grant lookup.
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' and p_page is not null and p_page between 0 and 9 and (p_member is null or p_member between 1 and 200) then
  select * into g from private.ticket_email_grants where token_hash=p_token_hash and purpose in ('initial','resend','recovery','event_change') and revoked_at is null and expires_at>clock_timestamp() and not overflow;
 end if;
 if g.id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(
  jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint(g.id::text)))) then return jsonb_build_object('kind','rate_limited'); end if;
 if g.purpose='event_change' and ((select count(*) from private.ticket_email_members where grant_id=g.id)<>1 or exists(select 1 from private.ticket_email_members candidate where candidate.grant_id=g.id and not coalesce((private.event_notice_detail(case when candidate.order_id is null then 'free_registration' else 'paid_order' end,coalesce(candidate.order_id,candidate.registration_id))->>'canViewTickets')::boolean,false))) then return null;end if;
 if p_member is not null then
  select * into m from private.ticket_email_members where grant_id=g.id and position=p_member;
  if not found then return null; end if;
  if m.order_id is not null then
   select confirmation_token_hash into proof from public.orders where id=m.order_id;
   select to_jsonb(p) into projection from public.server_lookup_paid_ticket_collection(proof) p;
  else
   select access_hash into proof from public.free_registrations where id=m.registration_id;
   projection:=public.server_lookup_free_ticket_collection(proof);
  end if;
  if projection is null then return null; end if;
  return jsonb_build_object('kind','member','sourceKind',case when m.order_id is null then 'free_registration' else 'paid_order' end,'projection',projection,'expiresAt',g.expires_at);
 end if;
 select count(*) into total from private.ticket_email_members where grant_id=g.id;
 select coalesce(jsonb_agg(jsonb_build_object('selector',x.position,'sourceKind',case when x.order_id is null then 'free_registration' else 'paid_order' end,
  'eventName',coalesce(f.facts->>'title','Event details unavailable'),'startsAt',f.facts->>'starts_at','eventFactsAvailable',f.facts is not null,'quantity',coalesce(o.quantity,r.quantity),'createdAt',coalesce(o.created_at,r.created_at)) order by x.position),'[]') into entries
 from (select * from private.ticket_email_members where grant_id=g.id order by position limit 20 offset p_page*20) x
 left join public.orders o on o.id=x.order_id left join public.free_registrations r on r.id=x.registration_id
 join public.events e on e.id=coalesce(o.event_id,r.event_id)
 cross join lateral (select private.approved_event_ticket_facts(e.id) facts) f;
 return jsonb_build_object('kind','index','expiresAt',g.expires_at,'total',total,'page',p_page,'nextPage',case when (p_page+1)*20<total then p_page+1 end,'collections',entries);
end;
$$;

