import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineBank, SurveyRound } from "./types";

// Plays a real round on the in-memory store with the AI mocked out, to check
// how lines written ahead are used. `after()` work is collected so a test can
// wait for it, and nothing is voiced.

const hoisted = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  writeLineBank: vi.fn(),
  writeHostLine: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => void hoisted.pending.push(Promise.resolve().then(fn)),
}));
vi.mock("./voice", () => ({ warmVoice: async () => {}, warmVoices: async () => {} }));
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  aiEnabled: () => true,
  writeSurvey: async () => ({ rounds: ROUNDS, source: "ai", gameIntro: "Welcome to the show." }),
  writeLineBank: hoisted.writeLineBank,
  writeHostLine: hoisted.writeHostLine,
  matchGuess: async () => null,
  writeRecap: async () => "Goodnight!",
}));

const { createGame, joinGame, performAction } = await import("./game-service");
const { getStore } = await import("./store");

const ROUNDS: SurveyRound[] = [
  {
    question: "Name something Dobby the house-elf loves.",
    answers: [
      { text: "Socks", points: 48, aliases: ["sock"] },
      { text: "Harry Potter", points: 26, aliases: ["harry"] },
      { text: "Freedom", points: 12, aliases: [] },
      { text: "Winky", points: 4, aliases: [] },
    ],
  },
  {
    question: "Name a sweet you'd buy at Honeydukes.",
    answers: [
      { text: "Chocolate Frog", points: 34, aliases: [] },
      { text: "Every Flavour Beans", points: 26, aliases: [] },
      { text: "Sugar Quill", points: 10, aliases: [] },
      { text: "Acid Pops", points: 4, aliases: [] },
    ],
  },
];

/** Wait for everything handed to `after()`, including work it queues in turn. */
async function settle() {
  while (hoisted.pending.length) await Promise.allSettled(hoisted.pending.splice(0));
}

async function poll<T>(fn: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  hoisted.writeLineBank.mockReset().mockImplementation(async ({ round }: { round: SurveyRound }): Promise<LineBank> => ({
    question: round.question,
    hits: round.answers.map((a) => ({ faceoff: `Banked face-off line for ${a.text}.`, play: `Banked play line for ${a.text}.` })),
  }));
  hoisted.writeHostLine.mockReset().mockImplementation(async ({ moment }: { moment: string }) =>
    moment.includes("board is revealing") ? "A live reaction." : "A live line.",
  );
});

describe("lines written ahead", () => {
  it("are written for the first rounds while players join, and used for a hit they fit", async () => {
    const { code, gameId } = await createGame({ packId: "harry-potter", rounds: 2 });
    await settle();
    // Both rounds' banks are written as soon as the survey is.
    expect(hoisted.writeLineBank).toHaveBeenCalledTimes(2);

    await joinGame(code, "Ron");
    await joinGame(code, "Hermione");
    const store = getStore();
    const state = async () => (await store.getById(gameId))!.state;
    const host = { gameId, role: "host" as const };
    const seat = (id: string) => ({ gameId, role: "player" as const, playerId: id });
    await settle();

    await performAction(code, seat((await state()).vipId!), { type: "start" });
    await settle();
    // Starting the round doesn't rewrite banks that already exist.
    expect(hoisted.writeLineBank).toHaveBeenCalledTimes(2);

    await performAction(code, host, { type: "skip" }); // end the intro: face-off called
    await settle();
    await performAction(code, host, { type: "skip" }); // open the face-off
    const turn = (await state()).turn!;
    expect(turn.kind).toBe("buzz");

    // Answer, have the TV finish "Survey says…", and wait for the reveal.
    const guess = async (type: "buzz" | "answer", turnId: string, playerId: string, text: string) => {
      const judged = performAction(code, seat(playerId), { type, turnId, text } as never);
      const lineId = await poll(async () => (await state()).turn?.judging?.lineId);
      await performAction(code, host, { type: "line_done", lineId });
      return (await judged).state;
    };

    // The first face-off answer is a hit: its line was written ahead, so nothing is written live.
    const first = await guess("buzz", turn.id, turn.playerIds[0], "harry");
    expect(first.hostLine?.text).toBe("Banked face-off line for Harry Potter.");
    expect(hoisted.writeHostLine.mock.calls.some(([input]) => input.moment.includes("board is revealing"))).toBe(false);

    // The second is judged against the first, which a line written ahead can't know: it's written live.
    await performAction(code, host, { type: "line_done", lineId: first.hostLine!.id }); // opens the reply
    const reply = (await state()).turn!;
    const second = await guess("answer", reply.id, reply.playerIds[0], "socks");
    expect(second.hostLine?.text).toBe("A live reaction.");
  }, 20_000);
});
