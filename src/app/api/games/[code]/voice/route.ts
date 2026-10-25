import { aiEnabled, speakHostLine } from "@/lib/ai";
import { seatFromRequest } from "@/lib/auth";
import { GameError } from "@/lib/engine";
import { loadGame } from "@/lib/game-service";
import { errorResponse, readJson } from "@/lib/http";
import { getPackTheme } from "@/packs";

// The host's voice: text-to-speech for the game's current host line, via the
// AI Gateway. Only the TV (host seat) may ask, and only for the line that is
// on screen right now, so this can't be used to synthesize arbitrary text.
export const maxDuration = 30;

const cache = new Map<string, { bytes: Uint8Array; mediaType: string }>();

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    if (!aiEnabled()) throw new GameError("AI voice is off", 404);
    const { code } = await ctx.params;
    const { lineId } = await readJson<{ lineId?: string }>(req);
    const game = await loadGame(code);
    const seat = seatFromRequest(req);
    if (seat?.role !== "host" || seat.gameId !== game.id) throw new GameError("Only the TV can voice the host", 403);
    const line = game.state.hostLine;
    if (!line || line.id !== lineId) throw new GameError("That line has passed", 409);

    let clip = cache.get(line.id);
    if (!clip) {
      clip = await speakHostLine(line.text, getPackTheme(game.state.packId).voice, { packId: game.state.packId });
      cache.set(line.id, clip);
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
    }
    return new Response(new Uint8Array(clip.bytes), {
      headers: { "Content-Type": clip.mediaType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
