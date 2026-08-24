begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select results_eq(
  $$
    select pg_catalog.has_column_privilege(
      'authenticated',
      'public.organizers',
      'id',
      'UPDATE'
    )
  $$,
  $$ values (false) $$,
  'Authenticated users cannot update organizer ownership'
);

select results_eq(
  $$
    select pg_catalog.has_column_privilege(
      'authenticated',
      'public.organizers',
      'onboarding_completed_at',
      'UPDATE'
    )
  $$,
  $$ values (true) $$,
  'Authenticated users can update onboarding completion'
);

insert into auth.users (id, email)
values (
  '10000000-0000-0000-0000-000000000071',
  'organizer-onboarding-update-test@example.invalid'
);

insert into public.organizers (
  id,
  display_name,
  onboarding_completed_at
)
values (
  '10000000-0000-0000-0000-000000000071',
  'Incomplete Organizer',
  null
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000071',
  true
);
set local role authenticated;

select lives_ok(
  $$
    update public.organizers
    set display_name = 'Completed Organizer',
        organizer_type = 'Community group',
        bio = 'Neighborhood events made with care.',
        website_url = 'https://baycity.example',
        base_city = 'San Francisco',
        country_code = 'US',
        onboarding_completed_at = now()
    where id = '10000000-0000-0000-0000-000000000071'
  $$,
  'An authenticated owner can complete an existing organizer profile without updating id'
);

select results_eq(
  $$
    select
      display_name,
      organizer_type,
      bio,
      website_url,
      base_city,
      country_code
    from public.organizers
    where id = '10000000-0000-0000-0000-000000000071'
  $$,
  $$
    values (
      'Completed Organizer'::text,
      'Community group'::text,
      'Neighborhood events made with care.'::text,
      'https://baycity.example'::text,
      'San Francisco'::text,
      'US'::text
    )
  $$,
  'The exact organizer onboarding fields are updated'
);

select results_eq(
  $$
    select onboarding_completed_at is not null
    from public.organizers
    where id = '10000000-0000-0000-0000-000000000071'
  $$,
  $$ values (true) $$,
  'The existing organizer becomes onboarding-complete'
);

reset role;
select * from finish();
rollback;
