import type { GameSecret, GameState, StoredGame } from "../types";

export type Mutator = (state: GameState) => GameState | null | Promise<GameState | null>;

/**
 * Persistence + realtime fan-out. Every write goes through `mutate`, which is a
 * compare-and-swap on `version` so simultaneous buzzes can't clobber each other.
 */
export interface GameStore {
  readonly kind: "memory" | "supabase";
  create(code: string, state: GameState): Promise<StoredGame>;
  getByCode(code: string): Promise<StoredGame | null>;
  getById(id: string): Promise<StoredGame | null>;
  /** Apply `fn` atomically. Returning null means "no change". */
  mutate(id: string, fn: Mutator): Promise<StoredGame>;
  getSecret(id: string): Promise<GameSecret | null>;
  setSecret(id: string, secret: GameSecret): Promise<void>;
}
