begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);

select results_eq(
  $$
    select coalesce(bool_or(privilege_type = 'EXECUTE'), false)
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'public'
      and procedures.proname = 'publish_event'
      and pg_catalog.pg_get_function_identity_arguments(procedures.oid) = 'p_event_id uuid'
      and privileges.grantee = 0
  $$,
  $$ values (false) $$,
  'PUBLIC cannot execute publish_event'
);

select results_eq(
  $$
    select pg_catalog.has_function_privilege(
      'anon',
      'public.publish_event(uuid)',
      'EXECUTE'
    )
  $$,
  $$ values (false) $$,
  'Anonymous cannot execute publish_event'
);

select results_eq(
  $$
    select pg_catalog.has_function_privilege(
      'authenticated',
      'public.publish_event(uuid)',
      'EXECUTE'
    )
  $$,
  $$ values (true) $$,
  'Authenticated users can execute publish_event'
);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'organizer-a-rls-test@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'organizer-b-rls-test@example.invalid');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    insert into public.organizers (id, display_name)
    values ('10000000-0000-0000-0000-000000000001', 'Organizer A')
  $$,
  'Organizer A can insert organizer id A'
);

select results_eq(
  $$
    update public.organizers
    set display_name = 'Organizer A Updated'
    where id = '10000000-0000-0000-0000-000000000001'
    returning display_name
  $$,
  $$ values ('Organizer A Updated'::text) $$,
  'Organizer A can update organizer id A'
);

select throws_ok(
  $$
    insert into public.organizers (id, display_name)
    values ('10000000-0000-0000-0000-000000000002', 'Impersonated Organizer B')
  $$,
  '42501',
  'new row violates row-level security policy for table "organizers"',
  'Organizer A cannot insert organizer id B'
);

reset role;
insert into public.organizers (id, display_name)
values
  ('10000000-0000-0000-0000-000000000001', 'Organizer A Fixture'),
  ('10000000-0000-0000-0000-000000000002', 'Organizer B Fixture')
on conflict (id) do update set display_name = excluded.display_name;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
  $$
    update public.organizers
    set display_name = 'Organizer B Compromised'
    where id = '10000000-0000-0000-0000-000000000002'
    returning id
  $$,
  'Organizer A cannot update organizer id B'
);

select throws_ok(
  $$
    delete from public.organizers
    where id = '10000000-0000-0000-0000-000000000002'
  $$,
  '42501',
  'permission denied for table organizers',
  'Organizer A cannot delete any organizer'
);

select lives_ok(
  $$
    insert into public.events (organizer_id, title)
    values ('10000000-0000-0000-0000-000000000001', 'Organizer A Draft')
  $$,
  'Organizer A can insert an owned draft'
);

select results_eq(
  $$
    select title
    from public.events
    where organizer_id = '10000000-0000-0000-0000-000000000001'
      and title = 'Organizer A Draft'
  $$,
  $$ values ('Organizer A Draft'::text) $$,
  'Organizer A can select an owned draft'
);

select results_eq(
  $$
    update public.events
    set title = 'Organizer A Updated Draft'
    where organizer_id = '10000000-0000-0000-0000-000000000001'
      and title = 'Organizer A Draft'
    returning title
  $$,
  $$ values ('Organizer A Updated Draft'::text) $$,
  'Organizer A can update an owned draft'
);

reset role;
insert into public.events (
  id, organizer_id, status, moderation_status, title
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'draft',
    'clear',
    'Cross Organizer Draft'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'published',
    'clear',
    'Published Clear Event'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'published',
    'under_review',
    'Published Under Review Event'
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'published',
    'blocked',
    'Published Blocked Event'
  ),
  (
    '30000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'published',
    'removed',
    'Published Removed Event'
  );

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is_empty(
  $$
    select id
    from public.events
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  'Organizer B cannot select Organizer A draft'
);

select is_empty(
  $$
    update public.events
    set title = title
    where id = '30000000-0000-0000-0000-000000000001'
    returning id
  $$,
  'Organizer B cannot update Organizer A draft'
);

select throws_ok(
  $$
    delete from public.events
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table events',
  'Organizer B cannot delete Organizer A draft'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select is_empty(
  $$
    select id
    from public.events
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  'Anonymous cannot see a draft'
);

select results_eq(
  $$
    select id
    from public.events
    where id = '30000000-0000-0000-0000-000000000002'
  $$,
  $$ values ('30000000-0000-0000-0000-000000000002'::uuid) $$,
  'Anonymous can see a published clear event'
);

select is_empty(
  $$
    select id
    from public.events
    where id = '30000000-0000-0000-0000-000000000003'
  $$,
  'Anonymous cannot see a published under-review event'
);

select is_empty(
  $$
    select id
    from public.events
    where id = '30000000-0000-0000-0000-000000000004'
  $$,
  'Anonymous cannot see a published blocked event'
);

select is_empty(
  $$
    select id
    from public.events
    where id = '30000000-0000-0000-0000-000000000005'
  $$,
  'Anonymous cannot see a published removed event'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
  $$
    select moderation_status
    from public.events
    where id in (
      '30000000-0000-0000-0000-000000000004',
      '30000000-0000-0000-0000-000000000005'
    )
    order by moderation_status
  $$,
  $$ values ('blocked'::text), ('removed'::text) $$,
  'Organizer A can still see its blocked and removed events'
);

select throws_ok(
  $$
    update public.events
    set organizer_id = organizer_id
    where title = 'Organizer A Updated Draft'
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly update organizer_id'
);

select throws_ok(
  $$
    update public.events
    set status = status
    where title = 'Organizer A Updated Draft'
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly update status'
);

select throws_ok(
  $$
    update public.events
    set moderation_status = moderation_status
    where title = 'Organizer A Updated Draft'
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly update moderation_status'
);

select throws_ok(
  $$
    update public.events
    set published_at = published_at
    where title = 'Organizer A Updated Draft'
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly update published_at'
);

select throws_ok(
  $$
    update public.events
    set location = location
    where title = 'Organizer A Updated Draft'
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly update location'
);

select throws_ok(
  $$
    insert into public.events (id, organizer_id)
    values (
      '30000000-0000-0000-0000-000000000006',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly insert event id'
);

select throws_ok(
  $$
    insert into public.events (organizer_id, status)
    values ('10000000-0000-0000-0000-000000000001', 'draft')
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly insert status'
);

select throws_ok(
  $$
    insert into public.events (organizer_id, moderation_status)
    values ('10000000-0000-0000-0000-000000000001', 'clear')
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly insert moderation_status'
);

select throws_ok(
  $$
    insert into public.events (organizer_id, published_at)
    values ('10000000-0000-0000-0000-000000000001', now())
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly insert published_at'
);

select throws_ok(
  $$
    insert into public.events (organizer_id, location)
    values ('10000000-0000-0000-0000-000000000001', null)
  $$,
  '42501',
  'permission denied for table events',
  'Authenticated browser cannot directly insert location'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$
    update public.events
    set status = status
    where id = '30000000-0000-0000-0000-000000000002'
  $$,
  '42501',
  'permission denied for table events',
  'Anonymous browser cannot directly update event lifecycle fields'
);

reset role;
select * from finish();
rollback;
