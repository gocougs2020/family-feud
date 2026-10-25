"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import { ApiError, fetchGame, type GameSnapshot } from "./api";

let supabase: { url: string; client: SupabaseClient } | null = null;
function supabaseClient(url: string, key: string) {
  if (supabase?.url !== url) supabase = { url, client: createClient(url, key, { auth: { persistSession: false } }) };
  return supabase.client;
}

export interface LiveGame {
  state: GameState | null;
  meta: Pick<GameSnapshot, "id" | "store" | "ai"> | null;
  error: string | null;
  /** the room doesn't exist, or has been shut down */
  notFound: boolean;
  /** the room existed but has been shut down */
  ended: boolean;
  connected: boolean;
  /** Apply a newer state (e.g. from an action response) without waiting for realtime. */
  apply: (version: number, state: GameState, serverNow?: number) => void;
  /** Current time on the server's clock, for countdowns. */
  serverNow: () => number;
}

/** 404: no such room; 410: it has been shut down. */
const gone = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 410);
const isShutDown = (err: unknown) => err instanceof ApiError && err.status === 410;

/**
 * Live game state for a room. Uses Supabase Realtime when the server has it
 * configured, otherwise Server-Sent Events from the local dev server. Either
 * way it also re-fetches on focus and every so often, so a dropped socket
 * never leaves a phone stuck. Once the room closes it stops listening, so a
 * forgotten tab doesn't keep hitting the server.
 */
export function useGame(code: string): LiveGame {
  const [state, setState] = useState<GameState | null>(null);
  const [meta, setMeta] = useState<LiveGame["meta"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [shutDown, setShutDown] = useState(false);
  const [connected, setConnected] = useState(false);
  const version = useRef(0);
  const offset = useRef(0);

  const apply = useCallback((v: number, next: GameState, serverNow?: number) => {
    if (serverNow) offset.current = serverNow - Date.now();
    if (v <= version.current) return;
    version.current = v;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchGame(code);
      apply(snap.version, snap.state, snap.now);
      setError(null);
      return snap;
    } catch (err) {
      if (gone(err)) setNotFound(true);
      if (isShutDown(err)) setShutDown(true);
      setError(err instanceof Error ? err.message : "Connection problem");
      return null;
    }
  }, [code, apply]);

  const closed = notFound || state?.phase === "closed";

  useEffect(() => {
    if (closed) return;
    let disposed = false;
    let teardown = () => {};

    fetchGame(code).then((snap) => {
      if (disposed) return;
      apply(snap.version, snap.state, snap.now);
      setMeta({ id: snap.id, store: snap.store, ai: snap.ai });

      if (snap.realtime.mode === "supabase") {
        const client = supabaseClient(snap.realtime.url, snap.realtime.key);
        const channel = client
          .channel(`game-${snap.id}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${snap.id}` },
            (payload) => {
              const row = payload.new as { version: number; state: GameState };
              apply(row.version, row.state);
            },
          )
          .subscribe((status) => {
            setConnected(status === "SUBSCRIBED");
            if (status === "SUBSCRIBED") refresh(); // catch anything missed while connecting
          });
        teardown = () => void client.removeChannel(channel);
      } else {
        const source = new EventSource(`/api/games/${code}/stream`);
        source.onopen = () => setConnected(true);
        source.onerror = () => setConnected(false);
        source.onmessage = (e) => {
          const data = JSON.parse(e.data) as { version: number; state: GameState };
          apply(data.version, data.state);
        };
        teardown = () => source.close();
      }
    }, (err) => {
      if (gone(err)) setNotFound(true);
      if (isShutDown(err)) setShutDown(true);
      setError(err instanceof Error ? err.message : "Connection problem");
    });

    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(refresh, 12_000);

    return () => {
      disposed = true;
      teardown();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, apply, refresh, closed]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  const ended = shutDown || state?.phase === "closed";
  return { state, meta, error, notFound, ended, connected: connected && !closed, apply, serverNow };
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
