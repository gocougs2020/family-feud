import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Stateless, signed seat tokens. The TV gets a host token when it creates a
// game; each phone gets a player token when it joins. They're kept in
// localStorage and sent as a Bearer header — no accounts needed.

export interface Seat {
  gameId: string;
  role: "host" | "player";
  playerId?: string;
}

function secret(): string {
  const value = process.env.SESSION_SECRET ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (value) return value;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("Set SESSION_SECRET (any long random string) in your environment.");
  }
  return "local-dev-only-secret";
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signSeat(seat: Seat): string {
  const payload = b64(JSON.stringify(seat));
  const sig = b64(createHmac("sha256", secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySeat(token: string | null | undefined): Seat | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Seat;
  } catch {
    return null;
  }
}

export function seatFromRequest(req: Request): Seat | null {
  const header = req.headers.get("authorization");
  return verifySeat(header?.startsWith("Bearer ") ? header.slice(7) : null);
}
