alter table merge_jobs add column if not exists originals_storage_keys text[];
alter table merge_jobs add column if not exists merged_storage_key text;
alter table merge_jobs add column if not exists undone_at timestamptz;
alter table merge_jobs add column if not exists result_start_time timestamptz;

alter table merge_jobs drop constraint if exists merge_jobs_status_check;
alter table merge_jobs add constraint merge_jobs_status_check
  check (status in ('pending', 'running', 'succeeded', 'failed', 'undone'));
