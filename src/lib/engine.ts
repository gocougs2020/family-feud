// The game rules, as pure functions: (state, input, ctx) -> new state.
// No I/O lives here, so it's easy to test and the same logic runs no matter
// which store (memory or Supabase) is behind it.
import type { HostLineKey, HostLines } from "@/packs/types";
import type {
  GameSecret,
  GameSettings,
  GameState,
  Guess,
  GuessResult,
  PublicPlayer,
  RoundState,
  TeamIndex,
  TeamPreset,
  Turn,
  TurnKind,
} from "./types";

export interface EngineCtx {
  now: number;
  rng: () => number;
  id: () => string;
  lines: HostLines;
}

export const TIMERS = {
  roundIntro: 9_000,
  /** face-off: type an answer, then buzz to lock it in */
  buzz: 25_000,
  /** face-off: the second player's reply, once the buzzer's answer is in */
  faceoffReply: 15_000,
  playPass: 15_000,
  steal: 40_000,
  roundEnd: 12_000,
  /** extra time granted while the AI judge is thinking */
  judging: 15_000,
  preparing: 60_000,
};

export const LIMITS = {
  maxPlayers: 16,
  nameLength: 16,
  answerLength: 60,
  minPlayersToStart: 2,
};

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function multiplierFor(index: number, total: number): number {
  if (total >= 3 && index === total - 1) return 3;
  if (total >= 4 && index === total - 2) return 2;
  return 1;
}

const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0);

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

function say(state: GameState, ctx: EngineCtx, key: HostLineKey, vars: Record<string, string | number> = {}): GameState {
  const template = pick(ctx.lines[key] ?? [""], ctx.rng);
  const text = template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
  return { ...state, hostLine: { id: ctx.id(), text } };
}

/** Use an AI-written line instead of a canned one. */
export function withHostLine(state: GameState, ctx: EngineCtx, text: string | undefined): GameState {
  return text ? { ...state, hostLine: { id: ctx.id(), text } } : state;
}

function emit(state: GameState, ctx: EngineCtx, event: Omit<NonNullable<GameState["event"]>, "id" | "at">): GameState {
  return { ...state, event: { ...event, id: ctx.id(), at: ctx.now } };
}

export function teamPlayers(state: GameState, team: TeamIndex): PublicPlayer[] {
  return state.players.filter((p) => p.team === team).sort((a, b) => a.joinedAt - b.joinedAt);
}

function playerName(state: GameState, id: string | null | undefined) {
  return state.players.find((p) => p.id === id)?.name ?? "Someone";
}

function requireRound(state: GameState): RoundState {
  if (!state.round) throw new GameError("No round in progress");
  return state.round;
}

function makeTurn(ctx: EngineCtx, kind: TurnKind, playerIds: string[], team: TeamIndex | null, ms: number): Turn {
  return { id: ctx.id(), kind, playerIds, team, deadline: ctx.now + ms };
}

/** Next player up for a team, advancing that team's rotation pointer. */
function nextUp(state: GameState, team: TeamIndex): { state: GameState; player: PublicPlayer | null } {
  const roster = teamPlayers(state, team);
  if (!roster.length) return { state, player: null };
  const pointer = state.rotation[team];
  const player = roster[pointer % roster.length];
  const rotation: [number, number] = [...state.rotation];
  rotation[team] = pointer + 1;
  return { state: { ...state, rotation }, player };
}

// ---------------------------------------------------------------- lobby

export function createGameState(input: {
  code: string;
  packId: string;
  topic?: string;
  settings: GameSettings;
  teams: [TeamPreset, TeamPreset];
  ctx: EngineCtx;
}): GameState {
  const { ctx } = input;
  const state: GameState = {
    v: 1,
    code: input.code,
    packId: input.packId,
    topic: input.topic,
    phase: "lobby",
    createdAt: ctx.now,
    settings: input.settings,
    players: [],
    vipId: null,
    teams: [
      { ...input.teams[0], score: 0 },
      { ...input.teams[1], score: 0 },
    ],
    prep: "pending",
    roundIndex: -1,
    round: null,
    turn: null,
    deadline: null,
    rotation: [0, 0],
    event: null,
    hostLine: null,
  };
  return say(state, ctx, "lobby");
}

export function addPlayer(
  state: GameState,
  input: { id: string; name: string; color: string },
  ctx: EngineCtx,
): GameState {
  const name = input.name.trim().slice(0, LIMITS.nameLength);
  if (!name) throw new GameError("Pick a name first");
  if (state.players.length >= LIMITS.maxPlayers) throw new GameError("This game is full", 409);
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new GameError("Someone already has that name", 409);
  }
  const counts = [teamPlayers(state, 0).length, teamPlayers(state, 1).length];
  const team: TeamIndex = counts[0] <= counts[1] ? 0 : 1;
  const player: PublicPlayer = { id: input.id, name, team, color: input.color, joinedAt: ctx.now };
  const next = { ...state, players: [...state.players, player], vipId: state.vipId ?? player.id };
  return emit(next, ctx, { kind: "join", playerId: player.id, team, text: name });
}

export function setTeam(state: GameState, playerId: string, team: TeamIndex): GameState {
  if (state.phase !== "lobby" && state.phase !== "game_over") throw new GameError("Teams are locked once the game starts");
  return { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, team } : p)) };
}

export function setTeamName(state: GameState, team: TeamIndex, name: string): GameState {
  const clean = name.trim().slice(0, 24);
  if (!clean) return state;
  const teams: GameState["teams"] = [...state.teams];
  teams[team] = { ...teams[team], name: clean };
  return { ...state, teams };
}

export function removePlayer(state: GameState, playerId: string): GameState {
  const players = state.players.filter((p) => p.id !== playerId);
  const vipId = state.vipId === playerId ? (players[0]?.id ?? null) : state.vipId;
  const turn = state.turn ? { ...state.turn, playerIds: state.turn.playerIds.filter((id) => id !== playerId) } : null;
  return { ...state, players, vipId, turn };
}

/** Make sure both teams have someone on them. */
function balanceTeams(state: GameState): GameState {
  const players = [...state.players].sort((a, b) => a.joinedAt - b.joinedAt);
  for (const t of [0, 1] as TeamIndex[]) {
    if (!players.some((p) => p.team === t)) {
      const donors = players.filter((p) => p.team === other(t));
      if (donors.length > 1) {
        const moved = donors[donors.length - 1];
        moved.team = t;
      }
    }
  }
  return { ...state, players: players.map((p) => ({ ...p })) };
}

export function startGame(state: GameState, secret: GameSecret | null, ctx: EngineCtx): GameState {
  if (state.phase !== "lobby") throw new GameError("The game has already started");
  if (state.players.length < LIMITS.minPlayersToStart) {
    throw new GameError(`Need at least ${LIMITS.minPlayersToStart} players to start`);
  }
  let next = balanceTeams(state);
  next = {
    ...next,
    teams: [
      { ...next.teams[0], score: 0 },
      { ...next.teams[1], score: 0 },
    ],
    rotation: [0, 0],
    recap: undefined,
    winner: undefined,
  };
  next = emit(next, ctx, { kind: "start" });
  if (!secret || state.prep !== "ready") {
    next = { ...next, phase: "preparing", deadline: ctx.now + TIMERS.preparing };
    return say(next, ctx, "preparing");
  }
  return beginRound(next, secret, 0, ctx, true);
}

/** Called once the hidden survey has been written. */
export function surveyReady(state: GameState, secret: GameSecret, ctx: EngineCtx): GameState {
  const next: GameState = { ...state, prep: "ready", surveySource: secret.source };
  if (state.phase === "preparing") return beginRound(next, secret, 0, ctx, true);
  return next;
}

// ---------------------------------------------------------------- rounds

export function beginRound(
  state: GameState,
  secret: GameSecret,
  index: number,
  ctx: EngineCtx,
  firstRound = false,
): GameState {
  const survey = secret.rounds[index];
  if (!survey) return endGame(state, ctx);
  const round: RoundState = {
    index,
    question: survey.question,
    multiplier: multiplierFor(index, state.settings.rounds),
    board: survey.answers.map(() => ({ revealed: false })),
    bank: 0,
    strikes: 0,
    control: null,
    faceoff: { playerIds: [null, null], answered: [] },
    guesses: [],
    winner: null,
    awarded: 0,
  };
  let next: GameState = {
    ...state,
    phase: "round_intro",
    roundIndex: index,
    round,
    turn: null,
    deadline: ctx.now + TIMERS.roundIntro + (firstRound ? 4_000 : 0),
  };
  next = emit(next, ctx, { kind: "round_start" });
  const vars = { round: index + 1, multiplier: round.multiplier, team: state.teams[0].name, other: state.teams[1].name };
  if (firstRound && secret.gameIntro) return withHostLine(next, ctx, secret.gameIntro);
  if (survey.intro) return withHostLine(next, ctx, survey.intro);
  return say(next, ctx, firstRound ? "gameIntro" : "roundIntro", vars);
}

function startFaceoff(state: GameState, ctx: EngineCtx): GameState {
  const round = requireRound(state);
  let next = state;
  const ids: [string | null, string | null] = [null, null];
  for (const t of [0, 1] as TeamIndex[]) {
    const r = nextUp(next, t);
    next = r.state;
    ids[t] = r.player?.id ?? null;
  }
  const playerIds = ids.filter((id): id is string => !!id);
  next = {
    ...next,
    phase: "faceoff",
    deadline: null,
    round: { ...round, faceoff: { playerIds: ids, answered: [] } },
    turn: makeTurn(ctx, "buzz", playerIds, null, TIMERS.buzz),
  };
  return say(next, ctx, "faceoff");
}

/**
 * Face-off buzz: the player types their answer first and buzzing submits it,
 * so the race is to think of an answer, not just to hit the button.
 */
export function buzz(state: GameState, playerId: string, turnId: string, text: string, ctx: EngineCtx): GameState {
  const turn = state.turn;
  if (state.phase !== "faceoff" || !turn || turn.kind !== "buzz") throw new GameError("Too late!", 409);
  if (turn.id !== turnId) throw new GameError("Too late!", 409);
  if (!turn.playerIds.includes(playerId)) throw new GameError("You're not in this face-off", 403);
  const clean = text.trim().slice(0, LIMITS.answerLength);
  if (!clean) throw new GameError("Type an answer first");
  const team = state.players.find((p) => p.id === playerId)?.team ?? 0;
  const answerTurn: Turn = { ...makeTurn(ctx, "faceoff_answer", [playerId], team, TIMERS.judging), judging: { playerId, text: clean } };
  let next: GameState = { ...state, turn: answerTurn };
  next = emit(next, ctx, { kind: "buzz", playerId, team, text: clean });
  return say(next, ctx, "buzz", { name: playerName(state, playerId) });
}

/** Lock in a guess while it's judged, so the TV can do "Survey says…". */
export function markJudging(state: GameState, playerId: string, turnId: string, text: string, ctx: EngineCtx): GameState {
  const turn = assertCanAnswer(state, playerId, turnId);
  if (turn.judging) throw new GameError("An answer is already being judged", 409);
  const clean = text.trim().slice(0, LIMITS.answerLength);
  if (!clean) throw new GameError("Type an answer first");
  const next: GameState = {
    ...state,
    turn: { ...turn, judging: { playerId, text: clean }, deadline: Math.max(turn.deadline, ctx.now + TIMERS.judging) },
  };
  return emit(next, ctx, { kind: "judging", playerId, text: clean, team: turn.team ?? undefined });
}

export function assertCanAnswer(state: GameState, playerId: string, turnId: string): Turn {
  const turn = state.turn;
  if (!turn || turn.id !== turnId) throw new GameError("That turn is over", 409);
  if (!["faceoff_answer", "answer", "steal"].includes(turn.kind)) throw new GameError("Not time to answer", 409);
  if (!turn.playerIds.includes(playerId)) throw new GameError("It's not your turn", 403);
  return turn;
}

function reveal(round: RoundState, secret: GameSecret, index: number): RoundState {
  const answer = secret.rounds[round.index].answers[index];
  const board = round.board.map((slot, i) =>
    i === index ? { revealed: true, text: answer.text, points: answer.points } : slot,
  );
  return { ...round, board, bank: round.bank + answer.points * round.multiplier };
}

function revealAll(round: RoundState, secret: GameSecret): RoundState {
  const answers = secret.rounds[round.index].answers;
  return {
    ...round,
    board: round.board.map((slot, i) =>
      slot.revealed ? slot : { revealed: true, auto: true, text: answers[i].text, points: answers[i].points },
    ),
  };
}

export interface GuessInput {
  turnId: string;
  playerId: string | null;
  text: string;
  /** index into the survey answers, or null if the judge found no match */
  answerIndex: number | null;
  timedOut?: boolean;
  /** an AI-written reaction to use instead of a canned line */
  quip?: string;
}

export function resolveGuess(state: GameState, secret: GameSecret, input: GuessInput, ctx: EngineCtx): GameState {
  const turn = state.turn;
  if (!turn || turn.id !== input.turnId) throw new GameError("That turn is over", 409);
  let round = requireRound(state);
  const survey = secret.rounds[round.index];
  const team: TeamIndex =
    turn.team ?? state.players.find((p) => p.id === input.playerId)?.team ?? 0;

  const idx = input.answerIndex;
  const result: GuessResult = input.timedOut
    ? "timeout"
    : idx == null || idx < 0 || idx >= survey.answers.length
      ? "miss"
      : round.board[idx].revealed
        ? "dupe"
        : "hit";
  const hitIndex = result === "hit" ? (idx as number) : null;

  const guess: Guess = {
    id: ctx.id(),
    playerId: input.playerId,
    team,
    text: input.text,
    result,
    answerIndex: hitIndex ?? undefined,
    at: ctx.now,
  };
  round = { ...round, guesses: [...round.guesses, guess] };
  if (hitIndex != null) round = reveal(round, secret, hitIndex);

  let next: GameState = { ...state, round, turn: null };
  const name = playerName(state, input.playerId);
  const answerText = hitIndex != null ? survey.answers[hitIndex].text : "";
  const vars = { name, answer: answerText, points: hitIndex != null ? survey.answers[hitIndex].points : 0 };

  const react = (fallback: HostLineKey, extra: Record<string, string | number> = {}) =>
    input.quip ? withHostLine(next, ctx, input.quip) : say(next, ctx, fallback, { ...vars, ...extra });

  switch (turn.kind) {
    case "faceoff_answer": {
      next = emit(next, ctx, { kind: result, playerId: input.playerId ?? undefined, team, answerIndex: hitIndex ?? undefined, text: input.text });
      next = react(hitIndex === 0 ? "topHit" : result === "hit" ? "hit" : result === "dupe" ? "dupe" : result === "timeout" ? "timeout" : "miss", { team: state.teams[team].name });
      const answered = [...round.faceoff.answered, { playerId: input.playerId ?? "", team, answerIndex: hitIndex }];
      next = { ...next, round: { ...round, faceoff: { ...round.faceoff, answered } } };
      if (hitIndex === 0) return toPlayOrPass(next, team, input.playerId, ctx);
      const opponent = round.faceoff.playerIds[other(team)];
      if (answered.length === 1 && opponent) {
        return { ...next, turn: makeTurn(ctx, "faceoff_answer", [opponent], other(team), TIMERS.faceoffReply) };
      }
      // Both have answered (or there's no opponent): the higher answer wins.
      const [first, second] = answered;
      const rank = (i: number | null) => (i == null ? Infinity : i);
      const winner = second && rank(second.answerIndex) < rank(first.answerIndex) ? second : first;
      return toPlayOrPass(next, winner.team, winner.playerId, ctx);
    }

    case "answer": {
      if (hitIndex != null) {
        next = emit(next, ctx, { kind: "hit", playerId: input.playerId ?? undefined, team, answerIndex: hitIndex, text: input.text });
        if (next.round!.board.every((s) => s.revealed)) {
          return awardRound(next, secret, team, ctx, "sweep");
        }
        next = react(hitIndex === 0 ? "topHit" : "hit");
        return nextAnswerTurn(next, team, ctx);
      }
      const strikes = round.strikes + 1;
      next = { ...next, round: { ...next.round!, strikes } };
      next = emit(next, ctx, { kind: result, playerId: input.playerId ?? undefined, team, text: input.text, strikes });
      if (strikes >= 3) return startSteal(next, team, ctx, input.quip);
      next = react(result === "dupe" ? "dupe" : result === "timeout" ? "timeout" : "miss");
      return nextAnswerTurn(next, team, ctx);
    }

    case "steal": {
      const control = other(team);
      if (hitIndex != null) {
        next = emit(next, ctx, { kind: "steal_hit", playerId: input.playerId ?? undefined, team, answerIndex: hitIndex, text: input.text });
        return awardRound(next, secret, team, ctx, "stealHit", input.quip);
      }
      next = emit(next, ctx, { kind: "steal_miss", playerId: input.playerId ?? undefined, team, text: input.text });
      return awardRound(next, secret, control, ctx, "stealMiss", input.quip);
    }

    default:
      throw new GameError("Not time to answer", 409);
  }
}

function toPlayOrPass(state: GameState, team: TeamIndex, playerId: string | null | undefined, ctx: EngineCtx): GameState {
  const chooser = playerId || teamPlayers(state, team)[0]?.id;
  if (!chooser) return choosePlayPassInternal(state, team, "play", ctx);
  return {
    ...state,
    phase: "play_or_pass",
    round: { ...state.round!, control: team },
    turn: makeTurn(ctx, "play_pass", [chooser], team, TIMERS.playPass),
  };
}

export function choosePlayPass(
  state: GameState,
  playerId: string,
  turnId: string,
  choice: "play" | "pass",
  ctx: EngineCtx,
): GameState {
  const turn = state.turn;
  if (state.phase !== "play_or_pass" || !turn || turn.id !== turnId) throw new GameError("Too late!", 409);
  if (!turn.playerIds.includes(playerId)) throw new GameError("It's not your call", 403);
  return choosePlayPassInternal(state, turn.team ?? 0, choice, ctx);
}

function choosePlayPassInternal(state: GameState, chooser: TeamIndex, choice: "play" | "pass", ctx: EngineCtx): GameState {
  const control = choice === "play" ? chooser : other(chooser);
  let next: GameState = { ...state, phase: "play", round: { ...state.round!, control } };
  next = emit(next, ctx, { kind: "control", team: control });
  next = say(next, ctx, "control", { team: state.teams[control].name });
  return nextAnswerTurn(next, control, ctx);
}

function nextAnswerTurn(state: GameState, team: TeamIndex, ctx: EngineCtx): GameState {
  const { state: next, player } = nextUp(state, team);
  const ids = player ? [player.id] : [];
  return { ...next, phase: "play", turn: makeTurn(ctx, "answer", ids, team, state.settings.answerSeconds * 1000) };
}

function startSteal(state: GameState, control: TeamIndex, ctx: EngineCtx, quip?: string): GameState {
  const stealTeam = other(control);
  const roster = teamPlayers(state, stealTeam).map((p) => p.id);
  let next: GameState = { ...state, phase: "steal" };
  next = say(next, ctx, "strikeOut", { team: state.teams[control].name, other: state.teams[stealTeam].name });
  if (quip) next = withHostLine(next, ctx, `${quip} ${next.hostLine?.text ?? ""}`.trim());
  if (!roster.length) return next; // nobody to steal; tick will award
  return { ...next, turn: makeTurn(ctx, "steal", roster, stealTeam, TIMERS.steal) };
}

function awardRound(
  state: GameState,
  secret: GameSecret,
  team: TeamIndex,
  ctx: EngineCtx,
  line: HostLineKey,
  quip?: string,
): GameState {
  const round = state.round!;
  const teams: GameState["teams"] = [...state.teams];
  teams[team] = { ...teams[team], score: teams[team].score + round.bank };
  let next: GameState = {
    ...state,
    phase: "round_end",
    teams,
    turn: null,
    deadline: ctx.now + TIMERS.roundEnd,
    round: { ...revealAll(round, secret), winner: team, awarded: round.bank },
  };
  next = say(next, ctx, line, { team: state.teams[team].name, points: round.bank });
  if (quip) next = withHostLine(next, ctx, `${quip} ${next.hostLine?.text ?? ""}`.trim());
  return next;
}

export function endGame(state: GameState, ctx: EngineCtx): GameState {
  const [a, b] = state.teams;
  const winner: TeamIndex | "tie" = a.score === b.score ? "tie" : a.score > b.score ? 0 : 1;
  let next: GameState = { ...state, phase: "game_over", turn: null, deadline: null, winner };
  next = emit(next, ctx, { kind: "game_over", team: winner === "tie" ? undefined : winner });
  return winner === "tie" ? say(next, ctx, "tie") : say(next, ctx, "gameOver", { team: state.teams[winner].name });
}

/** Reset to the lobby with the same players for another game. */
export function resetForReplay(state: GameState, ctx: EngineCtx, teams?: [TeamPreset, TeamPreset]): GameState {
  const next: GameState = {
    ...state,
    phase: "lobby",
    prep: "pending",
    surveySource: undefined,
    roundIndex: -1,
    round: null,
    turn: null,
    deadline: null,
    rotation: [0, 0],
    recap: undefined,
    winner: undefined,
    teams: [
      { ...(teams?.[0] ?? state.teams[0]), score: 0 },
      { ...(teams?.[1] ?? state.teams[1]), score: 0 },
    ],
  };
  return say(next, ctx, "lobby");
}

// ---------------------------------------------------------------- timers

/** The deadline that currently matters, if any. */
export function activeDeadline(state: GameState): number | null {
  return state.turn?.deadline ?? state.deadline;
}

/**
 * Advance the game when a timer runs out (or immediately when `force` is set,
 * which is how the host skips ahead). Returns null when nothing is due.
 */
export function tick(state: GameState, secret: GameSecret | null, ctx: EngineCtx, force = false): GameState | null {
  const deadline = activeDeadline(state);
  if (!force && (deadline == null || ctx.now < deadline)) return null;
  const turn = state.turn;

  switch (state.phase) {
    case "round_intro":
      return startFaceoff(state, ctx);

    case "faceoff": {
      if (!turn) return null;
      if (turn.kind === "buzz") {
        if (!turn.playerIds.length) return toPlayOrPass(state, 0, null, ctx);
        const chosen = pick(turn.playerIds, ctx.rng);
        const team = state.players.find((p) => p.id === chosen)?.team ?? 0;
        const next: GameState = {
          ...state,
          turn: makeTurn(ctx, "faceoff_answer", [chosen], team, TIMERS.faceoffReply),
        };
        return withHostLine(next, ctx, `Nobody buzzed! ${playerName(state, chosen)}, you're up.`);
      }
      return timeoutGuess(state, secret, turn, ctx);
    }

    case "play_or_pass":
      return choosePlayPassInternal(state, turn?.team ?? 0, "play", ctx);

    case "play":
      return turn ? timeoutGuess(state, secret, turn, ctx) : null;

    case "steal": {
      if (turn) return timeoutGuess(state, secret, turn, ctx);
      if (!secret) return null;
      return awardRound(state, secret, state.round?.control ?? 0, ctx, "stealMiss");
    }

    case "round_end": {
      if (!secret) return null;
      const nextIndex = state.roundIndex + 1;
      if (nextIndex >= Math.min(state.settings.rounds, secret.rounds.length)) return endGame(state, ctx);
      return beginRound(state, secret, nextIndex, ctx);
    }

    default:
      return null;
  }
}

function timeoutGuess(state: GameState, secret: GameSecret | null, turn: Turn, ctx: EngineCtx): GameState | null {
  if (!secret) return null;
  return resolveGuess(
    state,
    secret,
    {
      turnId: turn.id,
      playerId: turn.judging?.playerId ?? turn.playerIds[0] ?? null,
      text: turn.judging?.text ?? "",
      answerIndex: null,
      timedOut: true,
    },
    ctx,
  );
}
