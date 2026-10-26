import { aiEnabled } from "@/lib/ai";
import { seatFromRequest } from "@/lib/auth";
import { voiceParts } from "@/lib/captions";
import { GameError } from "@/lib/engine";
import { loadGame } from "@/lib/game-service";
import { errorResponse, readJson } from "@/lib/http";
import { voiceClip } from "@/lib/voice";

// The host's voice: text-to-speech for the game's current host line, via the
// AI Gateway, a sentence at a time (`part` indexes `voiceParts(line)`). Only
// the TV (host seat) may ask, and only for the line that is on screen right
// now, so this can't be used to synthesize arbitrary text.
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    if (!aiEnabled()) throw new GameError("AI voice is off", 404);
    const { code } = await ctx.params;
    const { lineId, part = 0 } = await readJson<{ lineId?: string; part?: number }>(req);
    const game = await loadGame(code);
    const seat = seatFromRequest(req);
    if (seat?.role !== "host" || seat.gameId !== game.id) throw new GameError("Only the TV can voice the host", 403);
    const line = game.state.hostLine;
    if (!line || line.id !== lineId) throw new GameError("That line has passed", 409);
    const text = voiceParts(line.text)[part];
    if (!Number.isInteger(part) || text == null) throw new GameError("No such part of the line", 400);

    const clip = await voiceClip(game.state.packId, text);
    return new Response(new Uint8Array(clip.bytes), {
      headers: {
        "Content-Type": clip.mediaType,
        "Cache-Control": "private, max-age=3600",
        // How fast to play it: 1 unless the voice model couldn't speed itself up.
        "X-Voice-Rate": String(clip.rate),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
