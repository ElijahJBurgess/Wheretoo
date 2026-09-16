create function public.server_read_ticket_email_access(p_token_hash text,p_ip_hash text,p_page integer default 0,p_member integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ticket_email_grants; m private.ticket_email_members; proof text; projection jsonb; entries jsonb; total integer;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 -- Malformed hashes/selectors still spend aggregate and invalid-IP capacity, with no grant lookup.
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' and p_page is not null and p_page between 0 and 9 and (p_member is null or p_member between 1 and 200) then
  select * into g from private.ticket_email_grants where token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp() and not overflow;
 end if;
 if g.id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(
  jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint(g.id::text)))) then return jsonb_build_object('kind','rate_limited'); end if;
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
  'eventName',e.title,'startsAt',e.starts_at,'quantity',coalesce(o.quantity,r.quantity),'createdAt',coalesce(o.created_at,r.created_at)) order by x.position),'[]') into entries
 from (select * from private.ticket_email_members where grant_id=g.id order by position limit 20 offset p_page*20) x
 left join public.orders o on o.id=x.order_id left join public.free_registrations r on r.id=x.registration_id
 join public.events e on e.id=coalesce(o.event_id,r.event_id);
 return jsonb_build_object('kind','index','expiresAt',g.expires_at,'total',total,'page',p_page,'nextPage',case when (p_page+1)*20<total then p_page+1 end,'collections',entries);
end;
$$;

-- Revocation changes access only. Admission identities and state are untouched.
create function public.server_revoke_ticket_email_grant(p_grant_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update private.ticket_email_grants set revoked_at=clock_timestamp() where id=p_grant_id and revoked_at is null;
 return found;
end;
$$;
-- Retention may remove old observations/outbox only once their linked grants expire.
-- Long-lived grants (including advance purchases) and every member remain protected.
create function public.server_prune_ticket_email_history() returns bigint
language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 delete from private.ticket_email_observations where attempt_id in (
  select q.id from private.ticket_email_outbox q left join private.ticket_email_grants g on g.id=q.grant_id
  where q.updated_at<clock_timestamp()-interval '90 days' and (g.id is null or g.expires_at<=clock_timestamp())
  and (q.state in ('accepted','failed','suppressed') or q.dispatch_stopped_reason is not null));
 delete from private.ticket_email_outbox q where q.updated_at<clock_timestamp()-interval '90 days'
  and (q.grant_id is null or exists(select 1 from private.ticket_email_grants g where g.id=q.grant_id and g.expires_at<=clock_timestamp()))
  and (q.state in ('accepted','failed','suppressed') or q.dispatch_stopped_reason is not null);
 get diagnostics removed=row_count;
 delete from private.ticket_email_grants g where expires_at<=clock_timestamp() and not exists(select 1 from private.ticket_email_outbox q where q.grant_id=g.id);
 delete from private.ticket_email_rate_events where at<clock_timestamp()-interval '2 days';
 return removed;
end;
$$;
revoke all on function public.server_read_ticket_email_access(text,text,integer,integer),public.server_revoke_ticket_email_grant(uuid),public.server_prune_ticket_email_history() from public,anon,authenticated,service_role;
grant execute on function public.server_read_ticket_email_access(text,text,integer,integer),public.server_revoke_ticket_email_grant(uuid),public.server_prune_ticket_email_history() to service_role;
