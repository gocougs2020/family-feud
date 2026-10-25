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
  const turnId = s.turn!.id;
  s = markJudging(s, playerId, turnId, text, ctx);
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

    // Draco buzzes and finds a lower answer; Harry then finds the top answer.
    s = buzz(s, "draco", s.turn!.id, ctx);
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
