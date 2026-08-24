begin;
select plan(16);

select has_extension('postgis', 'postgis is enabled');
select has_table('public', 'organizers', 'organizers exists');
select has_table('public', 'events', 'events exists');
select col_is_pk('public', 'organizers', 'id', 'organizer id is primary key');
select col_is_fk('public', 'organizers', 'id', 'organizer id references auth.users');
select col_is_fk('public', 'events', 'organizer_id', 'event belongs to an organizer');
select col_type_is('public', 'events', 'location', 'geography(Point,4326)', 'event location is geography');
select col_default_is('public', 'events', 'status', 'draft', 'events default to draft');
select col_default_is('public', 'events', 'moderation_status', 'clear', 'events default to clear moderation');
select has_check('public', 'organizers', 'organizers have check constraints');
select has_check('public', 'events', 'events have check constraints');
select has_index('public', 'events', 'events_organizer_id_idx', 'organizer index exists');
select has_index('public', 'events', 'events_organizer_status_idx', 'organizer/status index exists');
select has_index('public', 'events', 'events_starts_at_idx', 'start index exists');
select has_index('public', 'events', 'events_discovery_idx', 'discovery index exists');
select has_index('public', 'events', 'events_location_gix', 'spatial index exists');

select * from finish();
rollback;
