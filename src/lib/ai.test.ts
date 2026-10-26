import type { Experimental_DecisionModel } from "ai";
import { MockLanguageModelV4, MockSpeechModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { harryPotterContent } from "@/packs/harry-potter/content";
import { harryPotterTheme } from "@/packs/harry-potter/theme";
import { aiEnabled, aiVoiceEnabled, cueMoment, matchGuess, normalizeSurvey, speakHostLine, trimLine, voiceIdFor, writeHostLine, writeLineBank, writeSurvey } from "./ai";
import { VOICE_SPEED } from "./captions";

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
  Array.from({ length: n }, (_, i) => ({ text: `Answer ${i}`, points: 30 - i * 5, aliases: [`alias ${i}`], loose: [`loose ${i}`] }));

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
    expect(secret.rounds[0].answers[0].loose).toEqual(["loose 0"]);
  });

  it("asks for questions at the game's difficulty", async () => {
    const prompts: string[] = [];
    const survey = { gameIntro: "Hi", rounds: [{ question: "Q1?", intro: "One", answers: answers(5) }] };
    await writeSurvey({ pack: harryPotterContent, rounds: 1, teams: ["A", "B"], difficulty: "hard", model: mockModel(survey, prompts) });
    await writeSurvey({ pack: harryPotterContent, rounds: 1, teams: ["A", "B"], difficulty: "easy", model: mockModel(survey, prompts) });
    expect(prompts[0]).toContain("Difficulty: HARD");
    expect(prompts[1]).toContain("Difficulty: EASY");
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
  it("judges as strictly as the difficulty says, and counts loose phrasings only on easy", async () => {
    const shops = { question: "Name a shop in Hogsmeade.", answers: [{ text: "Honeydukes", points: 40, aliases: ["honey dukes"], loose: ["candy shop"] }] };
    const calls: DecideCall[] = [];
    for (const difficulty of ["easy", "medium", "hard"] as const) await matchGuess({ round: shops, guess: "sweets", difficulty, model: mockDecider("none", calls) });
    const [easy, medium, hard] = calls.map((c) => c.questions.match);
    expect(easy.type === "choice" && easy.criteria.a0).toBe("Honeydukes (also: honey dukes, candy shop)");
    expect(medium.type === "choice" && medium.criteria.a0).toBe("Honeydukes (also: honey dukes)");
    expect(easy.instructions).toContain("generous");
    expect(medium.instructions).toContain('"candy shop" is not "Honeydukes"');
    expect(hard.instructions).toContain("strict");
  });

  it("treats none as no match, and rejects options that aren't on the board", async () => {
    expect(await matchGuess({ round, guess: "toaster", model: mockDecider("none") })).toBeNull();
    await expect(matchGuess({ round, guess: "toaster", model: mockDecider("a42") })).rejects.toThrow();
  });
});

describe("writeHostLine", () => {
  it("writes a fresh line for the moment and tidies it for speech", async () => {
    const prompts: string[] = [];
    const line = await writeHostLine({
      pack: harryPotterContent,
      moment: cueMoment({ key: "join", vars: { joined: "Luna (Ravenclaw)", players: 3 } }),
      facts: "Teams: Ravenclaw vs Hufflepuff.",
      recent: ["Welcome, Harry!"],
      model: mockModel(' "Luna! *beams* Ravenclaw are lucky to have you." ', prompts),
    });
    expect(line).toBe("Luna! Ravenclaw are lucky to have you.");
    expect(prompts[0]).toContain("Luna (Ravenclaw)");
    expect(prompts[0]).toContain("Welcome, Harry!");
  });

  it("writes with reasoning off and one of the pack's comic angles", async () => {
    const prompts: string[] = [];
    const reasoning: unknown[] = [];
    await writeHostLine({
      pack: harryPotterContent,
      moment: cueMoment({ key: "miss", vars: { name: "Ron" } }),
      facts: "Teams: Gryffindor vs Slytherin.",
      model: mockModel("Not on the board, Ron.", prompts, reasoning),
    });
    expect(reasoning).toEqual(["none"]);
    expect(harryPotterContent.hostRiffs!.some((r) => prompts[0].includes(r.slice(0, 30)))).toBe(true);
  });

  it("describes every cue the engine can give", () => {
    // `rules` is always read as written, never cued.
    for (const key of Object.keys(harryPotterContent.lines).filter((k) => k !== "rules")) expect(cueMoment({ key, vars: {} })).not.toBe(key);
    expect(cueMoment({ key: "lobby", vars: { code: "ABCD" } })).toContain("A B C D");
    expect(cueMoment({ key: "roundIntro", vars: { round: 3, rounds: 4, multiplier: 2 } })).toContain("2x points");
  });
});

describe("speakHostLine", () => {
  type Call = { text: string; instructions?: string; voice?: string; speed?: number };
  type Warnings = Awaited<ReturnType<MockSpeechModelV4["doGenerate"]>>["warnings"];
  const speechModel = (modelId: string, calls: Call[], warnings: Warnings = []) =>
    new MockSpeechModelV4({
      modelId,
      doGenerate: async (options) => {
        calls.push(options);
        return { audio: new Uint8Array([73, 68, 51]), warnings, response: { timestamp: new Date(), modelId } };
      },
    });

  it("asks the model to talk at the host's pace, so the browser plays it as is", async () => {
    const calls: Call[] = [];
    const clip = await speakHostLine("Good answer!", harryPotterTheme.voice, { model: speechModel("fish-audio/drama-3", calls) });
    expect(calls[0].speed).toBe(VOICE_SPEED);
    expect(clip.rate).toBe(1);
  });

  it("has the browser speed it up when the model ignores the speed", async () => {
    const ignored = await speakHostLine("Good answer!", harryPotterTheme.voice, {
      model: speechModel("fish-audio/drama-3", [], [{ type: "unsupported", feature: "speed" }]),
    });
    expect(ignored.rate).toBe(VOICE_SPEED);

    const calls: Call[] = [];
    process.env.AI_TTS_NATIVE_SPEED = "0";
    const off = await speakHostLine("Good answer!", harryPotterTheme.voice, { model: speechModel("fish-audio/drama-3", calls) });
    delete process.env.AI_TTS_NATIVE_SPEED;
    expect(calls[0].speed).toBeUndefined();
    expect(off.rate).toBe(VOICE_SPEED);
  });

  it("gives Fish Audio the pack's delivery as inline cues, not instructions", async () => {
    const calls: Call[] = [];
    process.env.AI_TTS_VOICE_HARRY_POTTER = "voice-123";
    const clip = await speakHostLine("Ron says rat. [dramatic pause] Survey says…", harryPotterTheme.voice, {
      packId: "harry-potter",
      model: speechModel("fish-audio/drama-3", calls),
    });
    delete process.env.AI_TTS_VOICE_HARRY_POTTER;
    expect(clip.bytes).toEqual(new Uint8Array([73, 68, 51]));
    expect(clip.mediaType).toMatch(/^audio\//);
    expect(calls[0]).toMatchObject({ text: `[${harryPotterTheme.voice.cue}] Ron says rat. [dramatic pause] Survey says…`, voice: "voice-123" });
    expect(calls[0].instructions).toBeUndefined();
  });

  it("gives other speech models the plain line and the delivery notes", async () => {
    const calls: Call[] = [];
    await speakHostLine("[scoffs] Not even close.", harryPotterTheme.voice, { model: speechModel("openai/tts-1", calls) });
    expect(calls[0]).toMatchObject({ text: "Not even close.", instructions: harryPotterTheme.voice.style });
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

describe("cost switches", () => {
  it("runs AI only off the gateway API key, never Vercel's OIDC token", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_OIDC_TOKEN = "oidc";
    expect(aiEnabled()).toBe(false);
    process.env.AI_GATEWAY_API_KEY = "test-key";
    expect(aiEnabled()).toBe(true);
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL;
  });

  it("turns everything off with AI_DISABLED, and just the voice with AI_VOICE_DISABLED", () => {
    process.env.AI_GATEWAY_API_KEY = "test-key";
    expect([aiEnabled(), aiVoiceEnabled()]).toEqual([true, true]);
    process.env.AI_VOICE_DISABLED = "1";
    expect([aiEnabled(), aiVoiceEnabled()]).toEqual([true, false]);
    delete process.env.AI_VOICE_DISABLED;
    process.env.AI_DISABLED = "1";
    expect([aiEnabled(), aiVoiceEnabled()]).toEqual([false, false]);
    delete process.env.AI_DISABLED;
    delete process.env.AI_GATEWAY_API_KEY;
  });
});

describe("writeLineBank", () => {
  const round = {
    question: "Name something Dobby the house-elf loves.",
    answers: [
      { text: "Socks", points: 48, aliases: ["sock"] },
      { text: "Harry Potter", points: 26, aliases: ["harry"] },
      { text: "Freedom", points: 12, aliases: ["being free"] },
    ],
  };

  it("writes a reaction to every answer, matched to the board by name", async () => {
    const prompts: string[] = [];
    const reasoning: unknown[] = [];
    const bank = await writeLineBank({
      pack: harryPotterContent,
      round,
      roundNumber: 1,
      rounds: 4,
      model: mockModel(
        {
          answers: [
            { answer: "freedom", faceoff: "Freedom! [gasps] How very noble.", play: "Free at last, and on the board." },
            { answer: "Socks", faceoff: '"Socks! Of course it is."', play: "*beams* Socks. I gave him a pair myself." },
            { answer: "Harry Potter", faceoff: "Harry! Naturally.", play: "The boy who lived, and loves." },
          ],
        },
        prompts,
        reasoning,
      ),
    });
    expect(bank.question).toBe(round.question);
    expect(bank.hits).toEqual([
      { faceoff: "Socks! Of course it is.", play: "Socks. I gave him a pair myself." },
      { faceoff: "Harry! Naturally.", play: "The boy who lived, and loves." },
      { faceoff: "Freedom! [gasps] How very noble.", play: "Free at last, and on the board." },
    ]);
    expect(reasoning).toEqual(["low"]);
    expect(prompts[0]).toContain("1. Socks (48)");
  });

  it("has Haiku write the set when the survey model fails", async () => {
    const reasoning: unknown[] = [];
    const bank = await writeLineBank({
      pack: harryPotterContent,
      round,
      roundNumber: 1,
      rounds: 4,
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("The operation was aborted due to timeout");
        },
      }),
      fallbackModel: mockModel(
        {
          answers: [
            { answer: "Socks", faceoff: "Socks! Of course.", play: "Socks again." },
            { answer: "Harry Potter", faceoff: "Harry!", play: "The boy who lived." },
            { answer: "Freedom", faceoff: "Freedom!", play: "Free at last." },
          ],
        },
        [],
        reasoning,
      ),
    });
    expect(reasoning).toEqual(["none"]);
    expect(bank.hits[0]).toEqual({ faceoff: "Socks! Of course.", play: "Socks again." });
  });

  it("drops a line that would give away another answer still on the board", async () => {
    const bank = await writeLineBank({
      pack: harryPotterContent,
      round,
      roundNumber: 1,
      rounds: 4,
      model: mockModel({
        answers: [
          { answer: "Socks", faceoff: "Socks! Better than freedom, apparently.", play: "Socks. Predictable." },
          { answer: "Harry Potter", faceoff: "Harry Potter! Who else?", play: "Harry, over a sock? Bold." },
          { answer: "Freedom", faceoff: "Freedom, and a free elf at that.", play: "Freedom!" },
        ],
      }),
    });
    expect(bank.hits[0]).toEqual({ faceoff: undefined, play: "Socks. Predictable." });
    // A line may name its own answer, and words that only appear inside it.
    expect(bank.hits[1].faceoff).toBe("Harry Potter! Who else?");
    expect(bank.hits[1].play).toBeUndefined();
    expect(bank.hits[2].faceoff).toBe("Freedom, and a free elf at that.");
  });
});

describe("trimLine", () => {
  it("keeps short lines and cuts long ones at a boundary", () => {
    expect(trimLine("Brilliant!", 160)).toBe("Brilliant!");
    expect(trimLine("Splendid guess, Ron. But no professor answers to that title at the wedding", 40)).toBe("Splendid guess, Ron.");
    expect(trimLine("A splendid guess but no professor answers to that title", 30)).toBe("A splendid guess but no…");
  });
});
