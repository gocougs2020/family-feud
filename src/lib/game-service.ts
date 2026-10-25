import "server-only";
import { after } from "next/server";
import { getPackTheme } from "@/packs";
import { getPackContent } from "@/packs/server";
import { aiEnabled, cueMoment, matchGuess, writeHostLine, writeRecap, writeSurvey } from "./ai";
import { signSeat, type Seat } from "./auth";
import {
  addPlayer,
  buzz,
  choosePlayPass,
  createGameState,
  endGame,
  fitDeadlineToLine,
  GameError,
  markJudging,
  removePlayer,
  resetForReplay,
  resolveGuess,
  setTeam,
  setTeamName,
  startGame,
  surveyReady,
  teamPlayers,
  tick,
  withHostLine,
  type EngineCtx,
} from "./engine";
import { localMatch } from "./match";
import { getStore } from "./store";
import type { GameSecret, GameState, StoredGame, TeamIndex, TeamPreset, Turn } from "./types";
import { warmVoice } from "./voice";

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

// ------------------------------------------------------------ host lines
//
// The engine gives each canned line a cue. With AI on, that line is held as
// "pending" (screens wait for it) while the AI writes a fresh one for this
// moment of this game; if the AI is slow, the canned text goes out instead.
// Lines that are already AI-written (survey intros, judge reactions, recaps)
// go straight out. Either way the voice starts generating right away.

const logLine = (state: GameState, text: string): GameState => ({ ...state, hostLog: [...(state.hostLog ?? []), text].slice(-6) });

/** Hold a new cued line for the AI, or log a finished one. */
function prepareLine(prev: GameState | null, next: GameState): GameState {
  const line = next.hostLine;
  if (!line || line.id === prev?.hostLine?.id) return next;
  if (line.cue && aiEnabled()) return { ...next, hostLine: { ...line, pending: true } };
  return logLine(next, line.text);
}

/** Every game write goes through here, so no host line is missed. */
async function mutateGame(id: string, fn: (state: GameState, ctx: EngineCtx) => GameState | null) {
  let before: string | undefined;
  const result = await getStore().mutate(id, (s) => {
    before = s.hostLine?.id;
    const next = fn(s, ctxFor(s));
    return next && prepareLine(s, next);
  });
  afterLine(id, result.state, before);
  return result;
}

function afterLine(id: string, state: GameState, before?: string) {
  const line = state.hostLine;
  if (!aiEnabled() || !line || line.id === before) return;
  after(() => (line.pending ? finishLine(id, line.id) : warmVoice(state.packId, line.text)));
}

/** A short, public summary of the game for the AI host. */
function describeGame(state: GameState): string {
  const [a, b] = state.teams;
  const facts = [`Teams: ${a.name} (${a.score} points) vs ${b.name} (${b.score} points).`];
  for (const t of [0, 1] as TeamIndex[]) {
    const names = teamPlayers(state, t).map((p) => p.name);
    if (names.length) facts.push(`${state.teams[t].name} players: ${names.join(", ")}.`);
  }
  const round = state.round;
  if (round && state.phase !== "lobby") {
    facts.push(`Round ${round.index + 1} of ${state.settings.rounds}${round.multiplier > 1 ? ` (${round.multiplier}x points)` : ""}: "${round.question}"`);
    const shown = round.board.filter((slot) => slot.revealed && !slot.auto).map((slot) => `${slot.text} (${slot.points})`);
    facts.push(`On the board: ${shown.join(", ") || "nothing yet"}; ${round.board.filter((slot) => !slot.revealed).length} still hidden. Bank: ${round.bank}. Strikes: ${round.strikes}.`);
    if (round.control != null) facts.push(`${state.teams[round.control].name} control the board.`);
    const last = round.guesses[round.guesses.length - 1];
    if (last) facts.push(`Last guess: ${state.players.find((p) => p.id === last.playerId)?.name ?? "Someone"} said "${last.text || "(nothing)"}" (${last.result}).`);
  }
  return facts.join("\n");
}

/** Have the AI write a pending line, then release it. */
async function finishLine(id: string, lineId: string) {
  const store = getStore();
  const game = await store.getById(id);
  const line = game?.state.hostLine;
  if (!game || !line?.pending || line.id !== lineId || !line.cue) return;
  const { state } = game;
  let text = line.text;
  try {
    const written = await writeHostLine({
      pack: getPackContent(state.packId, state.topic),
      moment: cueMoment(line.cue),
      facts: describeGame(state),
      recent: state.hostLog,
    });
    text = [written, line.cue.tail].filter(Boolean).join(" ");
  } catch (err) {
    console.warn("[feud] AI host line failed, using the canned one:", err);
  }
  const voiced = warmVoice(state.packId, text);
  await store.mutate(id, (s) =>
    s.hostLine?.id === lineId && s.hostLine.pending
      ? fitDeadlineToLine(logLine({ ...s, hostLine: { id: lineId, text } }, text), Date.now())
      : null,
  );
  await voiced;
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
    const state = prepareLine(null, createGameState({
      code,
      packId: theme.id,
      topic,
      settings: { rounds, answerSeconds: 30 },
      teams: pickTeams(theme.id),
      ctx: { now: Date.now(), rng: Math.random, id: makeId, lines: getPackContent(theme.id, topic).lines },
    }));
    try {
      const game = await store.create(code, state);
      afterLine(game.id, game.state);
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
  await mutateGame(game.id, (state, ctx) => {
    const color = theme.playerColors[state.players.length % theme.playerColors.length];
    return addPlayer(state, { id: playerId, name, color }, ctx);
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
  await mutateGame(gameId, (s, ctx) => (s.prep === "ready" ? null : surveyReady(s, secret, ctx)));
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
    mutateGame(id, (state, ctx) => {
      const next = fn(state, ctx);
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
      result = await judgeAnswer(id, playerId, (s, ctx) => buzz(s, playerId, action.turnId, text, ctx), 2200);
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

/** What's riding on a guess, so the host's reaction can say what happens next. */
function describeStakes(state: GameState, turn: Turn, name: string): string {
  const round = state.round!;
  const team: TeamIndex = turn.team ?? 0;
  const rival: TeamIndex = team === 0 ? 1 : 0;
  const [us, them] = [state.teams[team].name, state.teams[rival].name];
  const nameOf = (pid: string | null | undefined) => state.players.find((p) => p.id === pid)?.name ?? "Someone";
  switch (turn.kind) {
    case "faceoff_answer": {
      const first = round.faceoff.answered[0];
      if (first) {
        const theirs = first.answerIndex == null ? "wasn't on the board" : `was the number ${first.answerIndex + 1} answer`;
        return `Face-off: ${name} (${us}) answers second. ${nameOf(first.playerId)}'s answer ${theirs}. The higher answer wins the face-off, and that player chooses to play or pass.`;
      }
      const opponent = round.faceoff.playerIds[rival];
      const buzzed = state.event?.kind === "buzz" ? "slammed the buzzer first" : "has to answer first";
      return `Face-off: ${name} (${us}) ${buzzed}. The number one answer wins the face-off outright. ${opponent ? `Otherwise ${nameOf(opponent)} (${them}) gets a chance to beat it, so hand over to them.` : `Otherwise ${us} still win it.`}`;
    }
    case "answer": {
      const hidden = round.board.filter((slot) => !slot.revealed).length;
      const miss =
        round.strikes === 2
          ? `A miss or a repeat is their third strike, and then ${them} get one chance to steal, so tell them to huddle up.`
          : "A miss or a repeat is a strike.";
      const sweep = hidden === 1 ? ` Only one answer is left: finding it clears the board and wins ${us} the round.` : "";
      return `${name} is answering for ${us}, who control the board with ${round.strikes} strike(s). ${miss}${sweep}`;
    }
    case "steal": {
      const control = state.teams[round.control ?? rival].name;
      return `Steal attempt: ${name} answers for ${us}. If it's on the board, ${us} steal the round's points. If not, ${control} keep the ${round.bank} points.`;
    }
    default:
      return "";
  }
}

/**
 * Lock the guess (a plain answer, or a face-off buzz that carries one), judge
 * it (locally, then with the AI judge), have the host react, and apply the
 * result. A buzz gets a slightly
 * longer beat so the buzzer and drum roll can land first.
 */
async function judgeAnswer(
  id: string,
  playerId: string,
  lock: (state: GameState, ctx: EngineCtx) => GameState,
  beat = 1800,
) {
  const store = getStore();
  const marked = await mutateGame(id, lock);
  const startedAt = Date.now();
  const secret = await store.getSecret(id);
  const state = marked.state;
  const turn = state.turn;
  const clean = turn?.judging?.text ?? "";
  if (!secret || !state.round || !turn) throw new GameError("The survey isn't ready yet", 409);
  const turnId = turn.id;
  const survey = secret.rounds[state.round.index];
  const pack = getPackContent(state.packId, state.topic);
  const name = state.players.find((p) => p.id === playerId)?.name ?? "A player";
  const moment = describeStakes(state, turn, name);

  let index = localMatch(clean, survey.answers);
  let quip: string | undefined;
  if (aiEnabled()) {
    if (index == null) {
      try {
        index = await matchGuess({ round: survey, guess: clean });
      } catch (err) {
        console.error("[feud] AI judge failed, treating as a miss:", err);
      }
    }
    try {
      const result =
        index == null
          ? `"${clean}" isn't on the board.`
          : state.round.board[index].revealed
            ? `"${clean}" is already on the board, so it counts as a miss.`
            : `"${clean}" matches the number ${index + 1} answer, ${survey.answers[index].text}, worth ${survey.answers[index].points}.`;
      quip = await writeHostLine({
        pack,
        moment: `${moment}\nResult: ${result} React to the guess as it's revealed and say what happens next.`,
        facts: describeGame(state),
        recent: state.hostLog,
      });
    } catch (err) {
      console.error("[feud] AI reaction failed:", err);
    }
    // Start voicing the reaction now, so it's ready the moment it's revealed.
    if (quip) void warmVoice(state.packId, quip);
  }

  // Give the TV a beat for "Survey says…".
  await sleep(Math.max(0, beat - (Date.now() - startedAt)));
  let finished = false;
  const result = await mutateGame(id, (s, ctx) => {
    if (s.turn?.id !== turnId) return null; // timed out or skipped meanwhile
    const next = resolveGuess(s, secret, { turnId, playerId, text: clean, answerIndex: index, quip }, ctx);
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
    // The host says the sign-off too, after the game-over line.
    await mutateGame(id, (s, ctx) => (s.phase === "game_over" && !s.recap ? withHostLine({ ...s, recap }, ctx, recap) : null));
  } catch (err) {
    console.error("[feud] recap failed:", err);
  }
}
