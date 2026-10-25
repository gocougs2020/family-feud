import { MockLanguageModelV4, MockSpeechModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { harryPotterContent } from "@/packs/harry-potter/content";
import { harryPotterTheme } from "@/packs/harry-potter/theme";
import { judgeGuess, normalizeSurvey, speakHostLine, trimLine, voiceIdFor, writeSurvey } from "./ai";

function mockModel(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const answers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `Answer ${i}`, points: 30 - i * 5, aliases: [`alias ${i}`] }));

describe("writeSurvey", () => {
  it("parses, sorts and trims the model's survey", async () => {
    const secret = await writeSurvey({
      pack: harryPotterContent,
      rounds: 2,
      teams: ["Gryffindor", "Slytherin"],
      model: mockModel({
        gameIntro: "Welcome!",
        rounds: [
          { question: "Q1?", intro: "First!", answers: [...answers(5)].reverse() },
          { question: "Q2?", intro: "Second!", answers: answers(6) },
          { question: "Q3?", intro: "Extra", answers: answers(5) },
        ],
      }),
    });
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

describe("judgeGuess", () => {
  const round = harryPotterContent.fallbackRounds[1];
  it("returns the matched index and the host's quip", async () => {
    const result = await judgeGuess({
      pack: harryPotterContent,
      round,
      guess: "the big snake",
      playerName: "Ron",
      model: mockModel({ index: 1, quip: "Hiss-terical, Ron!" }),
    });
    expect(result).toEqual({ index: 1, quip: "Hiss-terical, Ron!" });
  });
  it("treats -1 or out-of-range as no match", async () => {
    const result = await judgeGuess({ pack: harryPotterContent, round, guess: "toaster", playerName: "Ron", model: mockModel({ index: 42, quip: "No." }) });
    expect(result.index).toBeNull();
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
