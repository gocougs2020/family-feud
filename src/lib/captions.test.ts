import { describe, expect, it } from "vitest";
import { captionAt, estimateSpeechMs, partShares, plainText, splitCaptions, voiceParts, withCue } from "./captions";
import { SURVEY_SAYS } from "./engine";

describe("delivery cues", () => {
  it("are never shown", () => {
    expect(plainText("Logan says toad. [dramatic pause] Survey says…")).toBe("Logan says toad. Survey says…");
    expect(splitCaptions("[scoffs] A toad? Really.")).toEqual(["A toad? Really."]);
  });

  it("go before every sentence that doesn't have its own", () => {
    expect(withCue("A toad. [gasps] Really? Fine.", "smug")).toBe("[smug] A toad. [gasps] Really? [smug] Fine.");
  });
});

describe("splitCaptions", () => {
  it("shows a sentence at a time", () => {
    expect(splitCaptions("Welcome back to the show, everyone! Our next question is a tricky one. Ready?")).toEqual([
      "Welcome back to the show, everyone!",
      "Our next question is a tricky one. Ready?",
    ]);
  });

  it("keeps abbreviations and short exclamations attached", () => {
    expect(splitCaptions("Oh! Mr. Weasley would be proud of that answer, truly.")).toEqual([
      "Oh! Mr. Weasley would be proud of that answer, truly.",
    ]);
  });

  it("breaks long sentences at a clause", () => {
    const line =
      "Now, I once faced a whole room of Cornish pixies armed with nothing but my wand and my dazzling smile, and naturally I won without breaking a sweat.";
    expect(splitCaptions(line)).toEqual([
      "Now, I once faced a whole room of Cornish pixies",
      "armed with nothing but my wand and my dazzling smile,",
      "and naturally I won without breaking a sweat.",
    ]);
  });

  it("handles empty and single-sentence lines", () => {
    expect(splitCaptions("")).toEqual([]);
    expect(splitCaptions("  Survey says…  ")).toEqual(["Survey says…"]);
  });
});

describe("captionAt", () => {
  const captions = ["A first sentence here.", "And a second one too."];
  it("follows playback progress", () => {
    expect(captionAt(captions, 0)).toBe(0);
    expect(captionAt(captions, 0.3)).toBe(0);
    expect(captionAt(captions, 0.7)).toBe(1);
    expect(captionAt(captions, 1)).toBe(1);
  });

  it("estimates a faster rate as a shorter line", () => {
    expect(estimateSpeechMs("Hello there, everyone.", 1.2)).toBeLessThan(estimateSpeechMs("Hello there, everyone."));
  });
});

describe("voiceParts", () => {
  it("voices a line a sentence at a time", () => {
    expect(voiceParts("Welcome back to the show, everyone! Our next question is a tricky one.")).toEqual([
      "Welcome back to the show, everyone!",
      "Our next question is a tricky one.",
    ]);
  });

  it("folds short bits into the next sentence, keeping their cues", () => {
    expect(voiceParts("[gasps] Oh! Number one, of course it is.")).toEqual(["[gasps] Oh! Number one, of course it is."]);
    expect(voiceParts("That's the one, I'd know it anywhere. Fine.")).toEqual(["That's the one, I'd know it anywhere. Fine."]);
  });

  it("keeps \"Survey says…\" its own piece, so its voice is reused", () => {
    expect(voiceParts(`Ron says rat. ${SURVEY_SAYS}`)).toEqual(["Ron says rat.", SURVEY_SAYS]);
    expect(voiceParts(`Al says owl. ${SURVEY_SAYS}`)).toEqual(["Al says owl.", SURVEY_SAYS]);
  });

  it("shares a line's progress out by how long each piece takes to say", () => {
    const shares = partShares(["A short one.", "A much, much longer second sentence."]);
    expect(shares[0].start).toBe(0);
    expect(shares[0].share).toBeLessThan(shares[1].share);
    expect(shares[1].start + shares[1].share).toBeCloseTo(1);
    expect(voiceParts("")).toEqual([]);
  });
});
