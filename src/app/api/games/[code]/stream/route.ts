import { loadGame } from "@/lib/game-service";
import { errorResponse } from "@/lib/http";
import { subscribeMemory } from "@/lib/store/memory";

// Server-Sent Events for local "memory" mode. With Supabase configured,
// screens subscribe to Supabase Realtime directly instead.
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params;
    const game = await loadGame(code);
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream({
      start(controller) {
        const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        send({ version: game.version, state: game.state });
        const unsubscribe = subscribeMemory(game.id, (g) => send({ version: g.version, state: g.state }));
        const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
        };
        req.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {}
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
