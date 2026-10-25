"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createGame, seats } from "@/lib/client/api";
import { DEFAULT_PACK_ID, packThemes } from "@/packs";

export function Home({ status }: { status: { realtime: "supabase" | "local"; ai: boolean; deployed: boolean } }) {
  const router = useRouter();
  const [packId, setPackId] = useState(DEFAULT_PACK_ID);
  const [topic, setTopic] = useState("");
  const [rounds, setRounds] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const pack = packThemes.find((p) => p.id === packId)!;

  const host = async () => {
    setBusy(true);
    setError(null);
    try {
      const game = await createGame({ packId, topic: pack.customTopic ? topic : undefined, rounds });
      seats.set(game.code, "host", game.hostToken);
      router.push(`/host/${game.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a game");
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% -10%, #1d2a78 0%, transparent 60%), radial-gradient(ellipse at 100% 100%, #3a1a5a 0%, transparent 55%)" }}
      />
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-8 sm:py-16">
        <header className="flex flex-col gap-3">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-5xl leading-none text-glow sm:text-7xl"
          >
            Family Feud <span className="text-accent">Live</span>
          </motion.h1>
          <p className="max-w-2xl text-lg opacity-80">
            Put the show on a big screen. Everyone grabs their phone, joins with a room code, and plays — buzzing in, guessing, and stealing in real time. An AI host writes a fresh survey every game.
          </p>
        </header>

        {status.deployed && status.realtime === "local" && (
          <p className="rounded-2xl border border-strike/50 bg-strike/15 px-4 py-3 text-sm">
            <b>Database not connected.</b> This deployment is keeping games in memory, which doesn&apos;t work reliably on Vercel
            (players may drop out of rooms). Connect Supabase and run the migration — see the README&apos;s &ldquo;Deploy to Vercel&rdquo; steps.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <section className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-panel p-5 backdrop-blur sm:p-7">
            <div>
              <h2 className="text-xl font-bold">Host a game</h2>
              <p className="text-sm opacity-70">Open this on the screen everyone will watch.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {packThemes.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPackId(p.id)}
                  className="flex flex-col gap-2 rounded-2xl p-4 text-left transition hover:-translate-y-0.5"
                  style={{
                    background: `linear-gradient(160deg, ${p.colors.bgAlt}, ${p.colors.bg})`,
                    boxShadow: packId === p.id ? `0 0 0 3px ${p.colors.accent}, 0 10px 30px rgba(0,0,0,0.4)` : "0 0 0 1px rgba(255,255,255,0.12)",
                    color: p.colors.text,
                  }}
                >
                  <span className="text-3xl">{p.emoji}</span>
                  <span className="text-lg font-bold leading-tight" style={{ fontFamily: p.font === "cinzel" ? "var(--font-cinzel)" : "var(--font-anton)" }}>
                    {p.name}
                  </span>
                  <span className="text-xs opacity-75">{p.description}</span>
                </button>
              ))}
            </div>
            {pack.customTopic && (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Topic</span>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. The Office, 90s cartoons, our company offsite"
                  className="rounded-xl border-2 border-white/15 bg-black/40 px-4 py-3 outline-none focus:border-accent"
                />
                {!status.ai && <span className="text-xs text-strike">AI is off, so custom topics fall back to classic questions. Add AI_GATEWAY_API_KEY to enable.</span>}
              </label>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">Rounds</span>
                {[3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRounds(n)}
                    className={`size-9 rounded-lg font-bold ${rounds === n ? "bg-accent text-black" : "bg-white/10"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                onClick={host}
                disabled={busy || (pack.customTopic && !topic.trim())}
                className="font-display ml-auto rounded-2xl bg-accent px-7 py-3 text-xl text-black transition hover:scale-105 disabled:opacity-40"
              >
                {busy ? "Opening the studio…" : "Create game →"}
              </button>
            </div>
            {error && <p className="text-sm text-strike">{error}</p>}
          </section>

          <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-panel p-5 backdrop-blur sm:p-7">
            <div>
              <h2 className="text-xl font-bold">Join a game</h2>
              <p className="text-sm opacity-70">On your phone? Enter the code from the TV.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 4) router.push(`/play/${code}`);
              }}
              className="flex flex-col gap-3"
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                placeholder="ABCD"
                inputMode="text"
                autoCapitalize="characters"
                className="font-display rounded-xl border-2 border-white/15 bg-black/40 px-4 py-4 text-center text-4xl tracking-[0.4em] outline-none focus:border-accent"
              />
              <button disabled={code.length !== 4} className="font-display rounded-xl bg-white/90 py-3 text-xl text-black disabled:opacity-40">
                Join
              </button>
            </form>
            <ol className="mt-auto space-y-1 text-sm opacity-75">
              <li>1. Host creates a game on the TV or laptop.</li>
              <li>2. Players scan the QR code and pick a team.</li>
              <li>3. The VIP hits start. Survey says…!</li>
            </ol>
          </section>
        </div>

        <footer className="mt-auto flex flex-wrap items-center gap-3 text-xs opacity-70">
          <span className="rounded-full bg-white/10 px-3 py-1">
            Sync: {status.realtime === "supabase" ? "Supabase Realtime" : status.deployed ? "in-memory (connect Supabase!)" : "local dev server (memory)"}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1">AI host: {status.ai ? "on (Vercel AI Gateway)" : "off — using built-in questions"}</span>
          <span>Fan-made party game. Not affiliated with Family Feud, Fremantle, or any franchise in the packs.</span>
        </footer>
      </div>
    </main>
  );
}
