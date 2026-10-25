import "server-only";
import { getPackTheme } from "@/packs";
import { speakHostLine } from "./ai";

// Voiced host lines, shared by the voice route and the code that writes the
// lines. Keyed by text, so a line's audio can start generating the moment it's
// written, before the TV asks for it.

type Clip = Awaited<ReturnType<typeof speakHostLine>>;

const clips = new Map<string, Promise<Clip>>();

export function voiceClip(packId: string, text: string): Promise<Clip> {
  const key = `${packId}\n${text}`;
  let clip = clips.get(key);
  if (!clip) {
    clip = speakHostLine(text, getPackTheme(packId).voice, { packId });
    clip.catch(() => clips.delete(key));
    clips.set(key, clip);
    if (clips.size > 64) clips.delete(clips.keys().next().value!);
  }
  return clip;
}

/** Start voicing a line ahead of time; failures surface when the TV asks. */
export async function warmVoice(packId: string, text: string) {
  await voiceClip(packId, text).catch(() => {});
}
