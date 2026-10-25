import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameSecret, GameState, LineBank, StoredGame } from "../types";
import type { GameStore, Mutator } from "./types";

// Production store. Public game state lives in `games` (readable by anyone,
// published to Supabase Realtime); hidden answers live in `game_secrets`
// (no RLS policies, so only this service-role client can touch it), as do the
// host's lines written ahead for each round, in `game_line_banks`.

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!client) {
    const { url, secretKey } = supabaseEnv();
    client = createClient(url!, secretKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** Accepts both the Vercel Marketplace variable names and Supabase's newer key names. */
export function supabaseEnv() {
  const env = process.env;
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
    publicKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY,
    secretKey: env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function supabaseConfigured() {
  const { url, publicKey, secretKey } = supabaseEnv();
  return Boolean(url && publicKey && secretKey);
}

type Row = { id: string; code: string; version: number; state: GameState };

/** Rooms last at most an hour (see the `delete_stale_games` migration, also run every few minutes by pg_cron). */
const STALE = "1 hour";

export const supabaseStore: GameStore = {
  kind: "supabase",

  async create(code, state) {
    // Opportunistic cleanup keeps the free tier tidy without a cron job.
    await db().rpc("delete_stale_games", { max_age: STALE }).then(
      () => undefined,
      () => undefined,
    );
    const { data, error } = await db()
      .from("games")
      .insert({ code, state, version: 1 })
      .select("id, code, version, state")
      .single<Row>();
    if (error) throw new Error(error.code === "23505" ? "code taken" : error.message);
    return data;
  },

  async getByCode(code) {
    const { data, error } = await db()
      .from("games")
      .select("id, code, version, state")
      .eq("code", code)
      .maybeSingle<Row>();
    if (error) throw new Error(error.message);
    return data;
  },

  async getById(id) {
    const { data, error } = await db()
      .from("games")
      .select("id, code, version, state")
      .eq("id", id)
      .maybeSingle<Row>();
    if (error) throw new Error(error.message);
    return data;
  },

  async mutate(id, fn: Mutator) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: current, error } = await db()
        .from("games")
        .select("id, code, version, state")
        .eq("id", id)
        .single<Row>();
      if (error || !current) throw new Error("Game not found");
      const next = await fn(current.state);
      if (!next) return current;
      const { data: updated, error: writeError } = await db()
        .from("games")
        .update({ state: next, version: current.version + 1, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("version", current.version)
        .select("id, code, version, state")
        .maybeSingle<Row>();
      if (writeError) throw new Error(writeError.message);
      if (updated) return updated;
      // Someone else won the race; back off briefly and retry on fresh state.
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
    }
    throw new Error("Too much contention, try again");
  },

  async getSecret(id) {
    const { data, error } = await db().from("game_secrets").select("secret").eq("game_id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.secret as GameSecret | undefined) ?? null;
  },

  async setSecret(id, secret) {
    const { error } = await db().from("game_secrets").upsert({ game_id: id, secret });
    if (error) throw new Error(error.message);
  },

  async getBank(id, roundIndex) {
    const { data, error } = await db()
      .from("game_line_banks")
      .select("bank")
      .eq("game_id", id)
      .eq("round_index", roundIndex)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.bank as LineBank | undefined) ?? null;
  },

  async setBank(id, roundIndex, bank) {
    const { error } = await db().from("game_line_banks").upsert({ game_id: id, round_index: roundIndex, bank });
    if (error) throw new Error(error.message);
  },
};

export type { StoredGame };
