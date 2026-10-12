-- Preserve permanent mainline handles; never silently take an organizer's URL.
-- Mirrors main's existing waitlist-route reservation and conflict gate.
do $$begin
 if exists(select 1 from public.organizers where handle='map') then
  raise exception 'MAP_ROUTE_HANDLE_CONFLICT';
 end if;
end;$$;
create or replace function private.storefront_handle_valid(p_handle text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(char_length(p_handle) between 3 and 30 and p_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 and p_handle <> all(array['auth','discover','discovery','map','event-policy','event-status','events','moderation','orders','organizer','organizer-terms','refund-details','rsvp','ticket-access','waitlist','tickets','assets','api','terms','privacy','support','help','admin','login','signup','__dev']),false);
$$;
