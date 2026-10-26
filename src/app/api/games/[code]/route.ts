import { aiEnabled, aiVoiceEnabled } from "@/lib/ai";
import { loadGame } from "@/lib/game-service";
import { errorResponse } from "@/lib/http";
import { getStore, realtimeConfig } from "@/lib/store";

// Current public state plus how to subscribe to live updates.
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params;
    const game = await loadGame(code);
    return Response.json(
      { ...game, realtime: realtimeConfig(), store: getStore().kind, ai: aiEnabled(), voice: aiVoiceEnabled(), now: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
