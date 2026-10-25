-- Rooms last at most an hour, and shut-down rooms don't linger, so abandoned
-- games never keep running up hosting costs.
--
-- A room is stale when it is over an hour old (or idle that long), was closed
-- more than a minute ago (long enough for every screen to hear), or its TV
-- window closed and didn't come back in time (state.closesAt has passed).
create or replace function public.delete_stale_games(max_age interval default '1 hour')
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.games
    where created_at < now() - max_age
       or updated_at < now() - max_age
       or (state->>'phase' = 'closed' and updated_at < now() - interval '1 minute')
       or (state->>'closesAt')::double precision < extract(epoch from now()) * 1000
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.delete_stale_games(interval) from public, anon, authenticated;

-- Sweep every five minutes with pg_cron where it's available (it is on
-- Supabase). Without it, the server still sweeps whenever a game is created
-- and shuts expired rooms the next time any screen asks for them.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('feud-delete-stale-games', '*/5 * * * *', $job$select public.delete_stale_games('1 hour')$job$);
exception when others then
  raise notice 'pg_cron unavailable (%), skipping the scheduled sweep', sqlerrm;
end $$;
