import { describe, expect, it } from "vitest";
import { harryPotterContent } from "@/packs/harry-potter/content";
import {
  addPlayer,
  buzz,
  choosePlayPass,
  createGameState,
  markJudging,
  multiplierFor,
  resolveGuess,
  startGame,
  surveyReady,
  tick,
  TIMERS,
  type EngineCtx,
} from "./engine";
import { localMatch } from "./match";
import type { GameSecret, GameState } from "./types";

function makeCtx(): EngineCtx & { advance(ms: number): void } {
  let now = 1_000_000;
  let n = 0;
  return {
    get now() {
      return now;
    },
    rng: () => 0,
    id: () => `id${n++}`,
    lines: harryPotterContent.lines,
    advance(ms: number) {
      now += ms;
    },
  };
}

const secret: GameSecret = { rounds: harryPotterContent.fallbackRounds.slice(0, 2), source: "built-in" };

function lobby(ctx: EngineCtx): GameState {
  let s = createGameState({
    code: "ABCD",
    packId: "harry-potter",
    settings: { rounds: 2, answerSeconds: 30 },
    teams: [
      { name: "Gryffindor", color: "#c8322b" },
      { name: "Slytherin", color: "#2a9d5c" },
    ],
    ctx,
  });
  for (const name of ["Harry", "Draco", "Ron", "Pansy"]) s = addPlayer(s, { id: name.toLowerCase(), name, color: "#fff" }, ctx);
  return s;
}

function answer(s: GameState, playerId: string, text: string, ctx: EngineCtx) {
  s = s.turn!.kind === "buzz" ? buzz(s, playerId, s.turn!.id, text, ctx) : markJudging(s, playerId, s.turn!.id, text, ctx);
  const turnId = s.turn!.id;
  const index = localMatch(text, secret.rounds[s.round!.index].answers);
  return resolveGuess(s, secret, { turnId, playerId, text, answerIndex: index }, ctx);
}

describe("engine", () => {
  it("alternates teams as players join and makes the first player VIP", () => {
    const s = lobby(makeCtx());
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    expect(s.vipId).toBe("harry");
  });

  it("waits for the survey, then plays a full round with a steal", () => {
    const ctx = makeCtx();
    let s = startGame(lobby(ctx), null, ctx);
    expect(s.phase).toBe("preparing");
    s = surveyReady(s, secret, ctx);
    expect(s.phase).toBe("round_intro");

    ctx.advance(60_000);
    s = tick(s, secret, ctx)!;
    expect(s.phase).toBe("faceoff");
    expect(s.turn!.playerIds).toEqual(["harry", "draco"]);

    // A face-off buzz has to carry an answer.
    expect(() => buzz(s, "draco", s.turn!.id, "  ", ctx)).toThrow("Type an answer first");

    // Draco buzzes in with a lower answer; Harry then finds the top answer.
    s = answer(s, "draco", "robes", ctx);
    expect(s.round!.board[1].revealed).toBe(true);
    expect(s.turn!.playerIds).toEqual(["harry"]);
    s = answer(s, "harry", "a wand", ctx);
    expect(s.phase).toBe("play_or_pass");
    expect(s.round!.control).toBe(0);

    s = choosePlayPass(s, "harry", s.turn!.id, "play", ctx);
    expect(s.phase).toBe("play");
    // Rotation: Harry already faced off, so Ron is up.
    expect(s.turn!.playerIds).toEqual(["ron"]);

    s = answer(s, "ron", "cauldron", ctx);
    expect(s.round!.board[2].revealed).toBe(true);
    s = answer(s, "harry", "robes", ctx); // duplicate = strike
    expect(s.round!.strikes).toBe(1);
    s = answer(s, "ron", "a hippogriff", ctx);
    ctx.advance(31_000);
    s = tick(s, secret, ctx)!; // Harry runs out of time: third strike
    expect(s.phase).toBe("steal");
    expect(s.turn!.playerIds.sort()).toEqual(["draco", "pansy"]);

    const bank = s.round!.bank;
    s = answer(s, "pansy", "owl", ctx);
    expect(s.phase).toBe("round_end");
    expect(s.round!.winner).toBe(1);
    expect(s.teams[1].score).toBe(bank + 8);
    expect(s.round!.board.every((b) => b.revealed)).toBe(true);

    ctx.advance(20_000);
    s = tick(s, secret, ctx)!;
    expect(s.phase).toBe("round_intro");
    expect(s.round!.multiplier).toBe(multiplierFor(1, 2));
  });

  it("locks the buzzer's answer in for judging and gives the other player a shorter reply", () => {
    const ctx = makeCtx();
    let s = startGame(surveyReady(lobby(ctx), secret, ctx), secret, ctx);
    s = tick(s, secret, ctx, true)!;
    const buzzTurn = s.turn!.id;
    s = buzz(s, "harry", buzzTurn, " robes ", ctx);
    expect(s.event?.kind).toBe("buzz");
    expect(s.turn).toMatchObject({ kind: "faceoff_answer", playerIds: ["harry"], judging: { playerId: "harry", text: "robes" } });
    expect(() => buzz(s, "draco", buzzTurn, "wand", ctx)).toThrow("Too late!");

    s = resolveGuess(s, secret, { turnId: s.turn!.id, playerId: "harry", text: "robes", answerIndex: 1 }, ctx);
    expect(s.turn).toMatchObject({ kind: "faceoff_answer", playerIds: ["draco"], deadline: ctx.now + TIMERS.faceoffReply });
  });

  it("greets everyone who just joined, in one line", () => {
    const ctx = makeCtx();
    const s = lobby(ctx);
    expect(s.hostLine?.cue).toMatchObject({ key: "join", vars: { names: "Harry, Draco, Ron and Pansy" } });
    ctx.advance(60_000);
    const later = addPlayer(s, { id: "luna", name: "Luna", color: "#fff" }, ctx);
    expect(later.hostLine?.cue?.vars.names).toBe("Luna");
  });

  it("reads the question out and holds the intro until the host is done", () => {
    const ctx = makeCtx();
    const long = { ...secret, gameIntro: "Welcome! ".repeat(40).trim() };
    const s = startGame(surveyReady(lobby(ctx), long, ctx), long, ctx);
    expect(s.hostLine?.text.endsWith(long.rounds[0].question)).toBe(true);
    expect(s.hostLine?.cue).toBeUndefined(); // already AI-written
    expect(s.deadline! - ctx.now).toBeGreaterThan(TIMERS.roundIntro + 4_000);

    // A built-in survey uses the canned intro, cued for the AI, with the question as its tail.
    const canned = startGame(surveyReady(lobby(ctx), secret, ctx), secret, ctx);
    expect(canned.hostLine?.cue).toMatchObject({ key: "gameIntro", tail: secret.rounds[0].question });
  });

  it("leaves the buzz to the reaction and cues a line when nobody buzzes", () => {
    const ctx = makeCtx();
    let s = tick(startGame(surveyReady(lobby(ctx), secret, ctx), secret, ctx), secret, ctx, true)!;
    expect(s.hostLine?.cue).toMatchObject({ key: "faceoff", vars: { names: "Harry and Draco" } });
    const buzzed = buzz(s, "harry", s.turn!.id, "robes", ctx);
    expect(buzzed.hostLine).toBe(s.hostLine);
    ctx.advance(TIMERS.buzz);
    s = tick(s, secret, ctx)!;
    expect(s.hostLine?.cue).toMatchObject({ key: "noBuzz", vars: { name: "Harry" } });
  });

  it("ends the game after the last round", () => {
    const ctx = makeCtx();
    let s = surveyReady(lobby(ctx), secret, ctx);
    s = startGame(s, secret, ctx);
    s = { ...s, roundIndex: 1, phase: "round_end", deadline: ctx.now - 1 };
    s = tick(s, secret, ctx)!;
    expect(s.phase).toBe("game_over");
    expect(s.winner).toBe("tie");
  });
});

describe("localMatch", () => {
  const answers = harryPotterContent.fallbackRounds[1].answers; // creatures
  it("matches plurals, aliases and partial names", () => {
    expect(localMatch("Dementors", answers)).toBe(0);
    expect(localMatch("aragog", answers)).toBe(2);
    expect(localMatch("a big troll", answers)).toBe(3);
    expect(localMatch("basilsk", answers)).toBe(1);
  });
  it("rejects unrelated guesses", () => {
    expect(localMatch("house elf", answers)).toBeNull();
    const teachers = [{ text: "Snape", points: 9, aliases: [] }];
    expect(localMatch("snakes", teachers)).toBeNull();
    expect(localMatch("wand", [{ text: "Lumos", points: 22, aliases: ["wand lighting charm"] }])).toBeNull();
    expect(localMatch("", answers)).toBeNull();
  });
});
