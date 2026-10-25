import type { Experimental_DecisionModel } from "ai";
import { MockLanguageModelV4, MockSpeechModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { harryPotterContent } from "@/packs/harry-potter/content";
import { harryPotterTheme } from "@/packs/harry-potter/theme";
import { cueMoment, matchGuess, normalizeSurvey, speakHostLine, trimLine, voiceIdFor, writeHostLine, writeSurvey } from "./ai";

function mockModel(json: unknown, prompts: string[] = [], reasoning: unknown[] = []) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      reasoning.push(options.reasoning);
      return {
        content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

const answers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `Answer ${i}`, points: 30 - i * 5, aliases: [`alias ${i}`] }));

describe("writeSurvey", () => {
  it("parses, sorts and trims the model's survey", async () => {
    const reasoning: unknown[] = [];
    const secret = await writeSurvey({
      pack: harryPotterContent,
      rounds: 2,
      teams: ["Gryffindor", "Slytherin"],
      model: mockModel(
        {
          gameIntro: "Welcome!",
          rounds: [
            { question: "Q1?", intro: "First!", answers: [...answers(5)].reverse() },
            { question: "Q2?", intro: "Second!", answers: answers(6) },
            { question: "Q3?", intro: "Extra", answers: answers(5) },
          ],
        },
        [],
        reasoning,
      ),
    });
    expect(reasoning).toEqual(["medium"]);
    expect(secret.source).toBe("ai");
    expect(secret.gameIntro).toBe("Welcome!");
    expect(secret.rounds).toHaveLength(2);
    expect(secret.rounds[0].answers[0].points).toBe(30);
  });

  it("rejects surveys with too few usable questions", async () => {
    await expect(
      writeSurvey({
        pack: harryPotterContent,
        rounds: 2,
        teams: ["A", "B"],
        model: mockModel({ gameIntro: "", rounds: [{ question: "Q?", intro: "", answers: answers(2) }] }),
      }),
    ).rejects.toThrow();
  });
});

describe("normalizeSurvey", () => {
  it("dedupes answers and scales points over 100", () => {
    const [round] = normalizeSurvey([
      {
        question: "Q",
        answers: [
          { text: "Wand", points: 60, aliases: [] },
          { text: "wand", points: 10, aliases: [] },
          { text: "Owl", points: 50, aliases: [] },
          { text: "Cat", points: 30, aliases: [] },
          { text: "Toad", points: 20, aliases: [] },
        ],
      },
    ]);
    expect(round.answers.map((a) => a.text)).toEqual(["Wand", "Owl", "Cat", "Toad"]);
    expect(round.answers.reduce((s, a) => s + a.points, 0)).toBeLessThanOrEqual(100);
  });
});

type Decider = Extract<Experimental_DecisionModel, { doDecide: unknown }>;
type DecideCall = Parameters<Decider["doDecide"]>[0];

/** A stand-in decision model that picks `choice` and records what it was asked. */
function mockDecider(choice: string, calls: DecideCall[] = []): Decider {
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "typesafe-ai/jev",
    supportedQuestionTypes: ["choice"],
    doDecide: async (options) => {
      calls.push(options);
      return { answers: { match: { type: "choice", choice } }, warnings: [] };
    },
  };
}

describe("matchGuess", () => {
  const round = harryPotterContent.fallbackRounds[1];
  it("asks the decision model to pick a board answer, with aliases", async () => {
    const calls: DecideCall[] = [];
    expect(await matchGuess({ round, guess: "the big snake", model: mockDecider("a1", calls) })).toBe(1);
    const question = calls[0].questions.match;
    expect(question.type).toBe("choice");
    expect(question.type === "choice" && Object.keys(question.criteria)).toEqual(["none", ...round.answers.map((_, i) => `a${i}`)]);
    expect(JSON.stringify(calls[0].state)).toContain("the big snake");
  });
  it("treats none as no match, and rejects options that aren't on the board", async () => {
    expect(await matchGuess({ round, guess: "toaster", model: mockDecider("none") })).toBeNull();
    await expect(matchGuess({ round, guess: "toaster", model: mockDecider("a42") })).rejects.toThrow();
  });
});

describe("writeHostLine", () => {
  it("writes a fresh line for the moment and tidies it for speech", async () => {
    const prompts: string[] = [];
    const reasoning: unknown[] = [];
    const line = await writeHostLine({
      pack: harryPotterContent,
      moment: cueMoment({ key: "join", vars: { joined: "Luna (Ravenclaw)", players: 3 } }),
      facts: "Teams: Ravenclaw vs Hufflepuff.",
      recent: ["Welcome, Harry!"],
      model: mockModel(' "Luna! *beams* Ravenclaw are lucky to have you." ', prompts, reasoning),
    });
    expect(reasoning).toEqual(["low"]);
    expect(line).toBe("Luna! Ravenclaw are lucky to have you.");
    expect(prompts[0]).toContain("Luna (Ravenclaw)");
    expect(prompts[0]).toContain("Welcome, Harry!");
  });

  it("describes every cue the engine can give", () => {
    for (const key of Object.keys(harryPotterContent.lines)) expect(cueMoment({ key, vars: {} })).not.toBe(key);
    expect(cueMoment({ key: "lobby", vars: { code: "ABCD" } })).toContain("A B C D");
    expect(cueMoment({ key: "roundIntro", vars: { round: 3, rounds: 4, multiplier: 2 } })).toContain("2x points");
  });
});

describe("speakHostLine", () => {
  it("sends the line and the pack's delivery notes to the speech model", async () => {
    const calls: { text: string; instructions?: string; voice?: string }[] = [];
    const model = new MockSpeechModelV4({
      modelId: "fish-audio/drama-3",
      doGenerate: async (options) => {
        calls.push(options);
        return { audio: new Uint8Array([73, 68, 51]), warnings: [], response: { timestamp: new Date(), modelId: "fish-audio/drama-3" } };
      },
    });
    process.env.AI_TTS_VOICE_HARRY_POTTER = "voice-123";
    const clip = await speakHostLine("Survey says!", harryPotterTheme.voice, { packId: "harry-potter", model });
    delete process.env.AI_TTS_VOICE_HARRY_POTTER;
    expect(clip.bytes).toEqual(new Uint8Array([73, 68, 51]));
    expect(clip.mediaType).toMatch(/^audio\//);
    expect(calls[0]).toMatchObject({ text: "Survey says!", instructions: harryPotterTheme.voice.style, voice: "voice-123" });
  });

  it("picks a per-pack voice before the global one", () => {
    process.env.AI_TTS_VOICE = "global";
    expect(voiceIdFor("classic", harryPotterTheme.voice)).toBe("global");
    process.env.AI_TTS_VOICE_CLASSIC = "classic-voice";
    expect(voiceIdFor("classic", harryPotterTheme.voice)).toBe("classic-voice");
    delete process.env.AI_TTS_VOICE;
    delete process.env.AI_TTS_VOICE_CLASSIC;
    expect(voiceIdFor("classic", harryPotterTheme.voice)).toBeUndefined();
  });
});

describe("trimLine", () => {
  it("keeps short lines and cuts long ones at a boundary", () => {
    expect(trimLine("Brilliant!", 160)).toBe("Brilliant!");
    expect(trimLine("Splendid guess, Ron. But no professor answers to that title at the wedding", 40)).toBe("Splendid guess, Ron.");
    expect(trimLine("A splendid guess but no professor answers to that title", 30)).toBe("A splendid guess but no…");
  });
});
