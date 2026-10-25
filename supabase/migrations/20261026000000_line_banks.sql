-- The host's lines written ahead for each round: a reaction to every answer on
-- the board, ready the moment it's found. They name the answers, so like
-- game_secrets this table has RLS on and no policies (server only). One row per
-- round, so rounds written at the same time never overwrite each other.
create table if not exists public.game_line_banks (
  game_id uuid not null references public.games (id) on delete cascade,
  round_index integer not null,
  bank jsonb not null,
  primary key (game_id, round_index)
);

alter table public.game_line_banks enable row level security;
