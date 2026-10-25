"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Short URL to type on a phone: /play → enter the room code.
export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <h1 className="font-display text-4xl text-glow">Join a game</h1>
      <form
        className="flex w-full max-w-xs flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 4) router.push(`/play/${code}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
          placeholder="ROOM CODE"
          autoFocus
          autoCapitalize="characters"
          className="font-display rounded-xl border-2 border-white/15 bg-black/40 px-4 py-4 text-center text-4xl tracking-[0.3em] outline-none focus:border-accent"
        />
        <button disabled={code.length !== 4} className="font-display rounded-xl bg-accent py-4 text-2xl text-black disabled:opacity-40">
          Join
        </button>
      </form>
    </main>
  );
}
