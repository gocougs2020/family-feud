import "server-only";
import { GameError } from "./engine";

export function errorResponse(err: unknown) {
  if (err instanceof GameError) return Response.json({ error: err.message }, { status: err.status });
  console.error("[feud]", err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new GameError("Invalid request body");
  }
}
