import { EventEmitter } from "node:events";
import type { GameSecret, GameState, LineBank, StoredGame } from "../types";
import type { GameStore, Mutator } from "./types";

// Zero-setup store for local development: everything lives in this Node
// process and updates are pushed to screens over Server-Sent Events.
// Not suitable for serverless deployments (each instance has its own memory).

interface Entry extends StoredGame {
  secret: GameSecret | null;
  /** optional: rooms from before a hot reload don't have it */
  banks?: Map<number, LineBank>;
  updatedAt: number;
}

interface MemoryGlobals {
  games: Map<string, Entry>;
  byCode: Map<string, string>;
  bus: EventEmitter;
}

const g = globalThis as typeof globalThis & { __feudMemory?: MemoryGlobals };
const mem: MemoryGlobals =
  g.__feudMemory ??
  (g.__feudMemory = { games: new Map(), byCode: new Map(), bus: new EventEmitter().setMaxListeners(500) });

const SESSION_MS = 60 * 60 * 1000;
/** closed rooms are kept briefly so every screen hears they closed */
const CLOSED_MS = 60 * 1000;

/** Same rules as the Supabase `delete_stale_games` function. */
function stale(entry: Entry, now: number) {
  const { state } = entry;
  return (
    now - state.createdAt > SESSION_MS ||
    now - entry.updatedAt > SESSION_MS ||
    (state.phase === "closed" && now - entry.updatedAt > CLOSED_MS) ||
    (state.closesAt != null && now > state.closesAt)
  );
}

function sweep() {
  const now = Date.now();
  for (const [id, entry] of mem.games) {
    if (stale(entry, now)) {
      mem.games.delete(id);
      mem.byCode.delete(entry.code);
    }
  }
}

const view = ({ id, code, version, state }: Entry): StoredGame => ({ id, code, version, state });

export const memoryStore: GameStore = {
  kind: "memory",

  async create(code, state) {
    sweep();
    if (mem.byCode.has(code)) throw new Error("code taken");
    const entry: Entry = { id: crypto.randomUUID(), code, version: 1, state, secret: null, banks: new Map(), updatedAt: Date.now() };
    mem.games.set(entry.id, entry);
    mem.byCode.set(code, entry.id);
    return view(entry);
  },

  async getByCode(code) {
    const id = mem.byCode.get(code);
    const entry = id ? mem.games.get(id) : undefined;
    return entry ? view(entry) : null;
  },

  async getById(id) {
    const entry = mem.games.get(id);
    return entry ? view(entry) : null;
  },

  async mutate(id, fn: Mutator) {
    const entry = mem.games.get(id);
    if (!entry) throw new Error("Game not found");
    // Single-threaded: re-read after the await to detect interleaved writes.
    for (let attempt = 0; attempt < 8; attempt++) {
      const version = entry.version;
      const next = await fn(entry.state);
      if (!next) return view(entry);
      if (entry.version !== version) continue;
      entry.state = next as GameState;
      entry.version += 1;
      entry.updatedAt = Date.now();
      mem.bus.emit(id, view(entry));
      return view(entry);
    }
    throw new Error("Too much contention, try again");
  },

  async getSecret(id) {
    return mem.games.get(id)?.secret ?? null;
  },

  async setSecret(id, secret) {
    const entry = mem.games.get(id);
    if (entry) entry.secret = secret;
  },

  async getBank(id, roundIndex) {
    return mem.games.get(id)?.banks?.get(roundIndex) ?? null;
  },

  async setBank(id, roundIndex, bank) {
    const entry = mem.games.get(id);
    if (entry) (entry.banks ??= new Map()).set(roundIndex, bank);
  },
};

export function subscribeMemory(id: string, listener: (game: StoredGame) => void) {
  mem.bus.on(id, listener);
  return () => void mem.bus.off(id, listener);
}
