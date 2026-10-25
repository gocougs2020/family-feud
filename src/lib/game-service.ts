import "server-only";
import { after } from "next/server";
import { getPackTheme } from "@/packs";
import { getPackContent } from "@/packs/server";
import { aiEnabled, judgeGuess, writeRecap, writeSurvey } from "./ai";
import { signSeat, type Seat } from "./auth";
import {
  addPlayer,
  buzz,
  choosePlayPass,
  createGameState,
  endGame,
  GameError,
  markJudging,
  removePlayer,
  resetForReplay,
  resolveGuess,
  setTeam,
  setTeamName,
  startGame,
  surveyReady,
  tick,
  type EngineCtx,
} from "./engine";
import { localMatch } from "./match";
import { getStore } from "./store";
import type { GameSecret, GameState, StoredGame, TeamIndex, TeamPreset } from "./types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCode() {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
}

let counter = 0;
const makeId = () => `${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;

function ctxFor(state: GameState): EngineCtx {
  return { now: Date.now(), rng: Math.random, id: makeId, lines: getPackContent(state.packId, state.topic).lines };
}

function pickTeams(packId: string): [TeamPreset, TeamPreset] {
  const options = getPackTheme(packId).teams;
  const pair = options[Math.floor(Math.random() * options.length)];
  return Math.random() < 0.5 ? pair : [pair[1], pair[0]];
}

export function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

export async function loadGame(code: string): Promise<StoredGame> {
  const game = await getStore().getByCode(normalizeCode(code));
  if (!game) throw new GameError("No game with that code", 404);
  return game;
}

// ------------------------------------------------------------ create & join

export async function createGame(input: { packId: string; topic?: string; rounds?: number }) {
  const store = getStore();
  const theme = getPackTheme(input.packId);
  const topic = theme.customTopic ? input.topic?.trim().slice(0, 60) || undefined : undefined;
  if (theme.customTopic && !topic) throw new GameError("Type a topic for the AI to write about");
  const rounds = Math.min(6, Math.max(2, Math.round(input.rounds ?? 4)));

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const state = createGameState({
      code,
      packId: theme.id,
      topic,
      settings: { rounds, answerSeconds: 30 },
      teams: pickTeams(theme.id),
      ctx: { now: Date.now(), rng: Math.random, id: makeId, lines: getPackContent(theme.id, topic).lines },
    });
    try {
      const game = await store.create(code, state);
      // Write the survey while people are still joining.
      after(() => prepareSurvey(game.id));
      return { code, gameId: game.id, hostToken: signSeat({ gameId: game.id, role: "host" }) };
    } catch (err) {
      if (err instanceof Error && err.message === "code taken") continue;
      throw err;
    }
  }
  throw new GameError("Couldn't find a free room code, try again", 503);
}

export async function joinGame(code: string, name: string) {
  const game = await loadGame(code);
  const theme = getPackTheme(game.state.packId);
  const playerId = makeId();
  await getStore().mutate(game.id, (state) => {
    const color = theme.playerColors[state.players.length % theme.playerColors.length];
    return addPlayer(state, { id: playerId, name, color }, ctxFor(state));
  });
  return { playerId, token: signSeat({ gameId: game.id, role: "player", playerId }) };
}

// ------------------------------------------------------------ survey prep

function builtInSurvey(state: GameState, avoid: string[] = []): GameSecret {
  const content = getPackContent(state.packId, state.topic);
  const pool = [...content.fallbackRounds].sort(() => Math.random() - 0.5);
  const fresh = pool.filter((r) => !avoid.includes(r.question));
  const rounds = [...fresh, ...pool.filter((r) => avoid.includes(r.question))].slice(0, state.settings.rounds);
  return { rounds, source: "built-in" };
}

/** Write (or fall back to) the hidden survey, then let the game proceed. */
export async function prepareSurvey(gameId: string, opts: { forceBuiltIn?: boolean } = {}) {
  const store = getStore();
  const [game, previous] = await Promise.all([store.getById(gameId), store.getSecret(gameId)]);
  if (!game) return;
  const { state } = game;
  if (state.prep === "ready" && !opts.forceBuiltIn) return;
  const avoid = previous?.rounds.map((r) => r.question) ?? [];

  let secret: GameSecret | null = null;
  if (aiEnabled() && !opts.forceBuiltIn) {
    try {
      secret = await writeSurvey({
        pack: getPackContent(state.packId, state.topic),
        rounds: state.settings.rounds,
        teams: [state.teams[0].name, state.teams[1].name],
        avoid,
      });
    } catch (err) {
      console.error("[feud] AI survey failed, using the built-in questions:", err);
    }
  }
  secret ??= builtInSurvey(state, avoid);

  // Another path (e.g. a timeout fallback) may have finished first.
  const latest = await store.getById(gameId);
  if (!latest || latest.state.prep === "ready") return;
  await store.setSecret(gameId, secret);
  await store.mutate(gameId, (s) => (s.prep === "ready" ? null : surveyReady(s, secret, ctxFor(s))));
}

// ------------------------------------------------------------ actions

export type Action =
  | { type: "start" }
  | { type: "set_team"; team: TeamIndex }
  | { type: "rename_team"; team: TeamIndex; name: string }
  | { type: "buzz"; turnId: string; text: string }
  | { type: "answer"; turnId: string; text: string }
  | { type: "play_pass"; turnId: string; choice: "play" | "pass" }
  | { type: "tick" }
  | { type: "skip" }
  | { type: "kick"; playerId: string }
  | { type: "end" }
  | { type: "play_again" };

function requirePlayer(seat: Seat | null, state: GameState): string {
  if (!seat || seat.role !== "player" || !seat.playerId) throw new GameError("Join the game first", 401);
  if (!state.players.some((p) => p.id === seat.playerId)) throw new GameError("You're not in this game anymore", 403);
  return seat.playerId;
}

function requireHostOrVip(seat: Seat | null, state: GameState) {
  if (seat?.role === "host") return;
  if (seat?.role === "player" && seat.playerId === state.vipId) return;
  throw new GameError("Only the host or the VIP can do that", 403);
}

export async function performAction(code: string, seat: Seat | null, action: Action): Promise<StoredGame> {
  const game = await loadGame(code);
  if (seat && seat.gameId !== game.id) throw new GameError("That seat belongs to another game", 403);
  const store = getStore();
  const id = game.id;
  let finished = false;

  const run = (fn: (state: GameState, ctx: EngineCtx) => GameState | null) =>
    store.mutate(id, (state) => {
      const next = fn(state, ctxFor(state));
      if (next && next.phase === "game_over" && state.phase !== "game_over") finished = true;
      return next;
    });

  let result: StoredGame;
  switch (action.type) {
    case "start": {
      requireHostOrVip(seat, game.state);
      const secret = await store.getSecret(id);
      result = await run((s, ctx) => startGame(s, secret, ctx));
      break;
    }
    case "set_team": {
      const playerId = requirePlayer(seat, game.state);
      result = await run((s) => setTeam(s, playerId, action.team === 1 ? 1 : 0));
      break;
    }
    case "rename_team":
      requireHostOrVip(seat, game.state);
      result = await run((s) => setTeamName(s, action.team === 1 ? 1 : 0, String(action.name ?? "")));
      break;
    case "buzz": {
      const playerId = requirePlayer(seat, game.state);
      const text = String(action.text ?? "");
      result = await judgeAnswer(id, playerId, (s, ctx) => buzz(s, playerId, action.turnId, text, ctx), 2600);
      break;
    }
    case "play_pass": {
      const playerId = requirePlayer(seat, game.state);
      result = await run((s, ctx) => choosePlayPass(s, playerId, action.turnId, action.choice === "pass" ? "pass" : "play", ctx));
      break;
    }
    case "answer": {
      const playerId = requirePlayer(seat, game.state);
      const text = String(action.text ?? "");
      result = await judgeAnswer(id, playerId, (s, ctx) => markJudging(s, playerId, action.turnId, text, ctx));
      break;
    }
    case "tick":
    case "skip": {
      const force = action.type === "skip";
      if (force && seat?.role !== "host") requireHostOrVip(seat, game.state);
      if (game.state.phase === "preparing" && game.state.prep === "pending") {
        const overdue = (game.state.deadline ?? 0) <= Date.now();
        if (force || overdue) await prepareSurvey(id, { forceBuiltIn: true });
        result = await loadGame(code);
        break;
      }
      const secret = await store.getSecret(id);
      result = await run((s, ctx) => tick(s, secret, ctx, force));
      break;
    }
    case "kick":
      if (seat?.role !== "host") throw new GameError("Only the host can remove players", 403);
      result = await run((s) => removePlayer(s, action.playerId));
      break;
    case "end":
      if (seat?.role !== "host") throw new GameError("Only the host can end the game", 403);
      result = await run((s, ctx) => (s.phase === "game_over" ? null : endGame(s, ctx)));
      break;
    case "play_again":
      requireHostOrVip(seat, game.state);
      result = await run((s, ctx) => (s.phase === "game_over" ? resetForReplay(s, ctx, pickTeams(s.packId)) : null));
      if (result.state.phase === "lobby") after(() => prepareSurvey(id));
      break;
    default:
      throw new GameError("Unknown action");
  }

  if (finished && aiEnabled()) after(() => addRecap(id));
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lock the guess (a plain answer, or a face-off buzz that carries one), judge
 * it (locally, then with AI), and apply the result. A buzz gets a longer
 * beat so the buzzer sound and the host's "buzzed in" line can land first.
 */
async function judgeAnswer(
  id: string,
  playerId: string,
  lock: (state: GameState, ctx: EngineCtx) => GameState,
  beat = 1800,
) {
  const store = getStore();
  const marked = await store.mutate(id, (s) => lock(s, ctxFor(s)));
  const startedAt = Date.now();
  const secret = await store.getSecret(id);
  const state = marked.state;
  const turnId = state.turn?.id;
  const clean = state.turn?.judging?.text ?? "";
  if (!secret || !state.round || !turnId) throw new GameError("The survey isn't ready yet", 409);
  const survey = secret.rounds[state.round.index];

  let index = localMatch(clean, survey.answers);
  let quip: string | undefined;
  if (index == null && aiEnabled()) {
    try {
      const pack = getPackContent(state.packId, state.topic);
      const name = state.players.find((p) => p.id === playerId)?.name ?? "A player";
      ({ index, quip } = await judgeGuess({ pack, round: survey, guess: clean, playerName: name }));
    } catch (err) {
      console.error("[feud] AI judge failed, treating as a miss:", err);
    }
  }

  // Give the TV a beat for "Survey says…".
  await sleep(Math.max(0, beat - (Date.now() - startedAt)));
  let finished = false;
  const result = await store.mutate(id, (s) => {
    if (s.turn?.id !== turnId) return null; // timed out or skipped meanwhile
    const next = resolveGuess(s, secret, { turnId, playerId, text: clean, answerIndex: index, quip }, ctxFor(s));
    finished = next.phase === "game_over";
    return next;
  });
  if (finished && aiEnabled()) after(() => addRecap(id));
  return result;
}

async function addRecap(id: string) {
  try {
    const store = getStore();
    const game = await store.getById(id);
    if (!game || game.state.phase !== "game_over" || game.state.recap) return;
    const recap = await writeRecap({ pack: getPackContent(game.state.packId, game.state.topic), state: game.state });
    await store.mutate(id, (s) => (s.phase === "game_over" && !s.recap ? { ...s, recap } : null));
  } catch (err) {
    console.error("[feud] recap failed:", err);
  }
}
