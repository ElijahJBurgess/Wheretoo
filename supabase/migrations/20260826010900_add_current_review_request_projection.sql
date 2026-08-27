-- Expose only the current-revision organizer review state needed to reload
-- and operate the single-request UI. The private request row remains denied.

create function public.get_current_event_review_request(p_event_id uuid)
returns table (
  id uuid,
  status text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_input_sha256 text;
begin
  if auth.uid() is null or p_event_id is null then
    return;
  end if;

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid();

  if not found then
    return;
  end if;

  v_input_sha256 := private.compute_event_input_sha256(v_event.id);

  return query
  select
    requests.id,
    requests.status,
    requests.created_at,
    requests.resolved_at
  from private.moderation_review_requests as requests
  where requests.event_id = v_event.id
    and requests.organizer_id = auth.uid()
    and requests.content_revision = v_event.content_revision
    and requests.input_sha256 = v_input_sha256
    and requests.status in ('open', 'resolved', 'withdrawn')
  order by requests.created_at desc, requests.id desc
  limit 1;
end;
$$;

revoke all on function public.get_current_event_review_request(uuid)
from public, anon;
grant execute on function public.get_current_event_review_request(uuid)
to authenticated;

comment on function public.get_current_event_review_request(uuid) is
  'Owner-only current-revision review status projection. Returns no note, moderation reason, reviewer, report, staff, or digest data.';
