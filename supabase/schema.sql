-- Activity Editor schema
-- Run in Supabase SQL editor or via `supabase db push`

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

create table if not exists strava_tokens (
  user_id uuid primary key references users(id) on delete cascade,
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);

create table if not exists garmin_sessions (
  user_id uuid primary key references users(id) on delete cascade,
  oauth1_token text not null,
  oauth1_secret text not null,
  oauth2_token text not null,
  oauth2_expires_at timestamptz not null,
  username text,
  updated_at timestamptz not null default now()
);

create table if not exists merge_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null check (platform in ('strava', 'garmin')),
  source_activity_ids text[] not null,
  result_activity_id text,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists merge_jobs_user_idx on merge_jobs(user_id, created_at desc);
