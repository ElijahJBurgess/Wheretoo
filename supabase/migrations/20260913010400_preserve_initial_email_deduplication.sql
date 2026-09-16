-- Compact permanent issuance receipts survive delivery metadata retention.
-- Otherwise a far-later replay after rescheduling could enqueue another initial email.
create table private.ticket_email_initial_receipts (
 order_id uuid unique references public.orders(id) on delete restrict,
 registration_id uuid unique references public.free_registrations(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 check(num_nonnulls(order_id,registration_id)=1)
);
insert into private.ticket_email_initial_receipts(order_id,registration_id,created_at)
select order_id,registration_id,created_at from private.ticket_email_outbox where purpose='initial';
create or replace function private.enqueue_initial_ticket_email(p_kind text,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare active_since timestamptz; issued_at timestamptz; source jsonb;
begin
 select enabled_at into active_since from private.ticket_email_settings where singleton;
 if active_since is null then return; end if;
 if p_kind='paid_order' then select paid_at into issued_at from public.orders where id=p_id;
 elsif p_kind='free_registration' then select created_at into issued_at from public.free_registrations where id=p_id;
 else return; end if;
 if issued_at is null or issued_at<active_since then return; end if;
 source:=private.ticket_email_source(p_kind,p_id);
 if source is null or not (source->>'eligible')::boolean then return; end if;
 insert into private.ticket_email_initial_receipts(order_id,registration_id)
 values(case when p_kind='paid_order' then p_id end,case when p_kind='free_registration' then p_id end) on conflict do nothing;
 if not found then return; end if;
 insert into private.ticket_email_outbox(purpose,order_id,registration_id)
 values('initial',case when p_kind='paid_order' then p_id end,case when p_kind='free_registration' then p_id end) on conflict do nothing;
end;
$$;
revoke all on private.ticket_email_initial_receipts from public,anon,authenticated,service_role;
