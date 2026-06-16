alter table strava_tokens add column if not exists last_used_at timestamptz not null default now();

create index if not exists strava_tokens_last_used_idx on strava_tokens(last_used_at asc);
