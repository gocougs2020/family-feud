import "server-only";
import { getPackTheme } from "@/packs";
import { speakHostLine } from "./ai";
import { voiceParts } from "./captions";

// Voiced host lines, shared by the voice route and the code that writes the
// lines. A line is voiced a sentence at a time (see `voiceParts`), and each
// sentence's clip is kept by its text, so it can start generating the moment
// the line is written, before the TV asks for it, and a sentence that comes up
// again ("Survey says…", the rules) is voiced once.

type Clip = Awaited<ReturnType<typeof speakHostLine>>;

/** Least recently used first. Holds a round's worth of pre-written lines and then some. */
const clips = new Map<string, Promise<Clip>>();
const MAX_CLIPS = 160;

/** The clip for one voiced piece of a line. */
export function voiceClip(packId: string, part: string): Promise<Clip> {
  const key = `${packId}\n${part}`;
  let clip = clips.get(key);
  if (clip) {
    // Refresh, so sentences that keep coming up stay cached.
    clips.delete(key);
  } else {
    clip = speakHostLine(part, getPackTheme(packId).voice, { packId });
    clip.catch(() => clips.delete(key));
  }
  clips.set(key, clip);
  if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!);
  return clip;
}

/** Start voicing a line ahead of time, every sentence at once; failures surface when the TV asks. */
export async function warmVoice(packId: string, text: string) {
  await Promise.all(voiceParts(text).map((part) => voiceClip(packId, part).catch(() => {})));
}

/**
 * Voice lines that will (or may) come up later, a few at a time so a batch
 * doesn't crowd out the line being said now. Sentences already voiced are skipped.
 */
export async function warmVoices(packId: string, texts: string[], concurrency = 3) {
  const queue = [...new Set(texts.flatMap((t) => voiceParts(t)))].filter((part) => !clips.has(`${packId}\n${part}`));
  const worker = async () => {
    for (let part = queue.shift(); part != null; part = queue.shift()) await voiceClip(packId, part).catch(() => {});
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
