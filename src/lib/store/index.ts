import "server-only";
import { memoryStore } from "./memory";
import { supabaseConfigured, supabaseEnv, supabaseStore } from "./supabase";
import type { GameStore } from "./types";

export function getStore(): GameStore {
  return supabaseConfigured() ? supabaseStore : memoryStore;
}

export type RealtimeConfig =
  | { mode: "supabase"; url: string; key: string }
  | { mode: "sse" };

/** Tells screens how to listen for updates. Only public values are returned. */
export function realtimeConfig(): RealtimeConfig {
  if (!supabaseConfigured()) return { mode: "sse" };
  const { url, publicKey } = supabaseEnv();
  return { mode: "supabase", url: url!, key: publicKey! };
}
