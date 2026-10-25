import { joinGame } from "@/lib/game-service";
import { errorResponse, readJson } from "@/lib/http";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params;
    const { name } = await readJson<{ name?: string }>(req);
    return Response.json(await joinGame(code, String(name ?? "")));
  } catch (err) {
    return errorResponse(err);
  }
}
