-- Weekly Airfield Inspections — D1 schema.
--
--   npx wrangler d1 execute airfield-inspections --remote --file=db/schema.sql
--
-- Cloudflare is the record of truth. A phone keeps a completed inspection only
-- until this database confirms it, then deletes its copy.

create table if not exists inspections (
  -- The id is generated on the device before the record is queued, so a phone
  -- returning to signal can retry an upload it may have already completed.
  -- Combined with "insert or ignore", that retry is a no-op rather than a
  -- duplicate inspection — patchy reception at a lodge is the normal case.
  id            text primary key,

  week_ending   text not null,
  airfield      text not null,
  employee      text not null,

  check_grass    integer not null default 0,
  check_windsock integer not null default 0,
  check_surface  integer not null default 0,
  check_erosion  integer not null default 0,
  check_fod      integer not null default 0,

  issue_type    text not null check (issue_type in ('none', 'minor', 'major')),
  issue_note    text,

  signature     text not null,
  signed_date   text not null,

  -- When the inspector finished it (possibly offline, days earlier) versus when
  -- it reached us. Trend analysis wants the former; the gap between them tells
  -- you how long lodges are going without connectivity.
  completed_at  text not null,
  received_at   text not null default (datetime('now')),

  pdf_key       text,
  photo_count   integer not null default 0
);

create index if not exists inspections_airfield_week
  on inspections (airfield, week_ending desc);
create index if not exists inspections_completed
  on inspections (completed_at desc);
create index if not exists inspections_issue
  on inspections (issue_type);

create table if not exists inspection_photos (
  inspection_id text not null references inspections(id) on delete cascade,
  position      integer not null,
  r2_key        text not null,
  primary key (inspection_id, position)
);
