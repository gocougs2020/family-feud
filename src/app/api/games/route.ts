import { createGame } from "@/lib/game-service";
import { errorResponse, readJson } from "@/lib/http";

// Create a room. Returns the room code and the TV's host token.
export async function POST(req: Request) {
  try {
    const body = await readJson<{ packId?: string; topic?: string; rounds?: number }>(req);
    const game = await createGame({ packId: String(body.packId ?? ""), topic: body.topic, rounds: Number(body.rounds) || 4 });
    return Response.json(game);
  } catch (err) {
    return errorResponse(err);
  }
}
