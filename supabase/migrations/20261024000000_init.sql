-- Family Feud: schema for games, hidden surveys and realtime sync.
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

-- Public game state. Every screen subscribes to its row via Realtime.
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version integer not null default 1,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_updated_at_idx on public.games (updated_at);

-- Hidden survey answers. RLS is on with no policies, so only the server
-- (service role / secret key) can read or write this table.
create table if not exists public.game_secrets (
  game_id uuid primary key references public.games (id) on delete cascade,
  secret jsonb not null
);

alter table public.games enable row level security;
alter table public.game_secrets enable row level security;

-- Anyone may read game state (it never contains unrevealed answers).
-- Writes only happen from the server with the secret key, which bypasses RLS.
drop policy if exists "Game state is public" on public.games;
create policy "Game state is public" on public.games
  for select to anon, authenticated using (true);

-- Stream row updates to subscribed clients.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;

-- Housekeeping: the server calls this when creating a game so old rooms
-- (and their codes) get recycled without needing pg_cron.
create or replace function public.delete_stale_games(max_age interval default '24 hours')
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.games where updated_at < now() - max_age returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.delete_stale_games(interval) from public, anon, authenticated;
