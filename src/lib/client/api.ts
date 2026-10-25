"use client";

import type { Action } from "@/lib/game-service";
import type { GameState } from "@/lib/types";

export type Role = "host" | "player";

export const seatKey = (code: string, role: Role) => `feud:${role}:${code.toUpperCase()}`;

/** Seat tokens live in localStorage so a refresh (or a phone locking) doesn't lose your seat. */
export const seats = {
  get(code: string, role: Role): string | null {
    try {
      return localStorage.getItem(seatKey(code, role));
    } catch {
      return null;
    }
  },
  set(code: string, role: Role, token: string) {
    try {
      localStorage.setItem(seatKey(code, role), token);
    } catch {}
  },
  clear(code: string, role: Role) {
    try {
      localStorage.removeItem(seatKey(code, role));
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export type ActionResult = { version: number; state: GameState; now: number };

export function createGame(input: { packId: string; topic?: string; rounds: number }) {
  return request<{ code: string; gameId: string; hostToken: string }>("/api/games", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinGame(code: string, name: string) {
  return request<{ playerId: string; token: string }>(`/api/games/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function sendAction(code: string, action: Action, token: string | null) {
  return request<ActionResult>(`/api/games/${code}/action`, {
    method: "POST",
    body: JSON.stringify(action),
    token,
  });
}

export type RealtimeConfig = { mode: "supabase"; url: string; key: string } | { mode: "sse" };

export type GameSnapshot = {
  id: string;
  code: string;
  version: number;
  state: GameState;
  realtime: RealtimeConfig;
  store: "memory" | "supabase";
  ai: boolean;
  now: number;
};

export function fetchGame(code: string) {
  return request<GameSnapshot>(`/api/games/${code}`);
}

/** Decode the player id out of a seat token (the signature is checked server-side). */
export function playerIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.playerId ?? null;
  } catch {
    return null;
  }
}
