import { describe, expect, it } from "vitest";
import { captionAt, estimateSpeechMs, splitCaptions } from "./captions";

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
