create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table public.organizers (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  organizer_type text,
  bio text,
  website_url text,
  base_city text,
  country_code text not null default 'US',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizers_display_name_check check (char_length(btrim(display_name)) between 2 and 100),
  constraint organizers_type_check check (organizer_type is null or char_length(btrim(organizer_type)) between 1 and 80),
  constraint organizers_bio_check check (bio is null or char_length(bio) <= 500),
  constraint organizers_website_check check (
    website_url is null or (
      char_length(website_url) <= 500 and
      (website_url like 'https://%' or website_url like 'http://%')
    )
  ),
  constraint organizers_base_city_check check (base_city is null or char_length(btrim(base_city)) between 1 and 120),
  constraint organizers_country_code_check check (country_code ~ '^[A-Z]{2}$')
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  moderation_status text not null default 'clear' check (moderation_status in ('clear', 'flagged', 'blocked', 'removed')),
  title text check (title is null or char_length(btrim(title)) <= 120),
  description text check (description is null or char_length(description) <= 5000),
  category text check (category is null or category in ('food_drink', 'music', 'fitness', 'art_culture', 'shopping', 'community', 'nightlife', 'other')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/Los_Angeles',
  venue_name text check (venue_name is null or char_length(btrim(venue_name)) <= 160),
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text not null default 'US',
  mapbox_feature_id text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  location extensions.geography(Point, 4326),
  admission_type text not null default 'free' check (admission_type in ('free', 'paid')),
  capacity integer check (capacity is null or capacity > 0),
  artwork_path text,
  animation_preset text not null default 'generic',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_coordinate_pair_check check ((latitude is null) = (longitude is null)),
  constraint events_time_order_check check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint events_country_code_check check (country_code ~ '^[A-Z]{2}$')
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_event_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.location := case
    when new.longitude is null or new.latitude is null then null
    else extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography
  end;
  return new;
end;
$$;

create trigger organizers_set_updated_at before update on public.organizers
for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();
create trigger events_sync_location before insert or update of longitude, latitude on public.events
for each row execute function public.sync_event_location();

create index events_organizer_id_idx on public.events (organizer_id);
create index events_organizer_status_idx on public.events (organizer_id, status);
create index events_starts_at_idx on public.events (starts_at);
create index events_discovery_idx on public.events (status, moderation_status, starts_at);
create index events_location_gix on public.events using gist (location);
