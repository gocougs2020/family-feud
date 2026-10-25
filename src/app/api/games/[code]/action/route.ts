import { seatFromRequest } from "@/lib/auth";
import { performAction, type Action } from "@/lib/game-service";
import { errorResponse, readJson } from "@/lib/http";

// Every in-game move (buzz, answer, start, tick...) comes through here.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params;
    const action = await readJson<Action>(req);
    const game = await performAction(code, seatFromRequest(req), action);
    return Response.json({ version: game.version, state: game.state, now: Date.now() });
  } catch (err) {
    return errorResponse(err);
  }
}
