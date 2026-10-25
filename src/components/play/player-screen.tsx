"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Countdown } from "@/components/countdown";
import { themeVars } from "@/components/theme-vars";
import { ApiError, joinGame, playerIdFromToken, seatKey, sendAction } from "@/lib/client/api";
import { useGame } from "@/lib/client/use-game";
import { useHydrated, useStored } from "@/lib/client/use-stored";
import { activeDeadline, LIMITS, TIMERS } from "@/lib/engine";
import type { GameState, PublicPlayer, TeamIndex } from "@/lib/types";
import { getPackTheme } from "@/packs";

type Act = (action: Record<string, unknown>) => Promise<boolean>;

export function PlayerScreen({ code }: { code: string }) {
  const live = useGame(code);
  const { state, apply, serverNow } = live;
  const theme = getPackTheme(state?.packId ?? "classic");
  const [token, setToken] = useStored(seatKey(code, "player"));
  const loaded = useHydrated();
  const [toast, setToast] = useState<string | null>(null);

  const myId = playerIdFromToken(token);
  const me = state?.players.find((p) => p.id === myId) ?? null;

  const act: Act = useCallback(
    async (action) => {
      try {
        const res = await sendAction(code, action as never, token);
        apply(res.version, res.state, res.now);
        return true;
      } catch (err) {
        if (action.type !== "tick") {
          setToast(err instanceof Error ? err.message : "Something went wrong");
          setTimeout(() => setToast(null), 2600);
        }
        return false;
      }
    },
    [code, token, apply],
  );

  // Backup clock in case the TV tab is asleep: phones nudge the server a bit late.
  const deadline = state ? activeDeadline(state) : null;
  const inGame = !!me;
  useEffect(() => {
    if (!deadline || !inGame) return;
    const t = setTimeout(() => act({ type: "tick" }), Math.max(0, deadline - serverNow()) + 2500 + Math.random() * 1500);
    return () => clearTimeout(t);
  }, [deadline, inGame, act, serverNow]);

  // Buzz the phone when it's your move.
  const myTurn = !!(me && state?.turn?.playerIds.includes(me.id));
  const turnId = state?.turn?.id;
  useEffect(() => {
    if (myTurn) navigator.vibrate?.([80, 40, 80]);
  }, [myTurn, turnId]);

  if (live.notFound) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-xl">No game with code <b>{code}</b>.</p>
          <Link href="/play" className="rounded-xl bg-accent px-5 py-3 font-semibold text-black">
            Try another code
          </Link>
        </div>
      </Shell>
    );
  }
  if (!state || !loaded) {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center opacity-70">Connecting…</div>
      </Shell>
    );
  }

  return (
    <div style={themeVars(theme, state.teams)} className="flex min-h-dvh flex-col bg-bg text-ink">
      <div
        className="pointer-events-none fixed inset-0 -z-0 opacity-60"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${theme.colors.bgAlt}, transparent 70%)` }}
      />
      {me ? (
        <>
          <Header state={state} me={me} />
          <main className="relative z-10 flex flex-1 flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            <PhaseView state={state} me={me} act={act} serverNow={serverNow} />
          </main>
        </>
      ) : (
        <JoinForm
          code={code}
          state={state}
          kicked={!!token}
          onJoined={setToken}
        />
      )}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed inset-x-4 bottom-6 z-50 rounded-xl bg-strike px-4 py-3 text-center font-semibold text-white shadow-xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-bg p-6 text-ink">{children}</div>;
}

// ------------------------------------------------------------ joining

function JoinForm({ code, state, kicked, onJoined }: { code: string; state: GameState; kicked: boolean; onJoined: (token: string) => void }) {
  const theme = getPackTheme(state.packId);
  const [savedName, saveName] = useStored("feud:name");
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? savedName ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await joinGame(code, name);
      saveName(name.trim());
      onJoined(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't join, try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-5 px-5 py-10">
      <div className="text-center">
        <div className="text-5xl">{theme.emoji}</div>
        <h1 className="font-display mt-3 text-3xl text-glow">{theme.name}</h1>
        <p className="mt-1 text-sm opacity-70">
          Room <span className="font-mono font-bold tracking-widest text-accent">{code}</span>
          {state.phase !== "lobby" && " · game in progress, you'll join the smaller team"}
        </p>
      </div>
      {kicked && <p className="rounded-lg bg-white/10 p-3 text-center text-sm">You&apos;re not in this game right now. Join again below.</p>}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold opacity-80">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.nameLength}
          autoFocus
          autoComplete="nickname"
          placeholder="e.g. Luna"
          className="rounded-xl border-2 border-white/15 bg-black/40 px-4 py-4 text-xl outline-none focus:border-accent"
        />
      </label>
      {error && <p className="text-center text-sm text-strike">{error}</p>}
      <button disabled={busy || !name.trim()} className="font-display rounded-xl bg-accent py-4 text-2xl text-black transition active:scale-95 disabled:opacity-40">
        {busy ? "Joining…" : "Join game"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------ chrome

function Header({ state, me }: { state: GameState; me: PublicPlayer }) {
  return (
    <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-3" style={{ background: `color-mix(in srgb, var(--c-team-${me.team}) 85%, black)` }}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-3 shrink-0 rounded-full ring-2 ring-white/60" style={{ background: me.color }} />
        <span className="truncate font-bold">{me.name}</span>
        {state.vipId === me.id && <span className="rounded bg-black/30 px-1.5 text-xs font-bold">VIP</span>}
      </div>
      <div className="flex items-center gap-3 text-sm font-semibold">
        <span>
          {state.teams[0].name.split(" ")[0]} {state.teams[0].score}
        </span>
        <span className="opacity-60">·</span>
        <span>
          {state.teams[1].name.split(" ")[0]} {state.teams[1].score}
        </span>
      </div>
    </header>
  );
}

function Big({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="font-display text-3xl leading-tight">{children}</div>
      {sub && <div className="max-w-xs text-base opacity-75">{sub}</div>}
    </motion.div>
  );
}

function MiniBoard({ state }: { state: GameState }) {
  const round = state.round;
  if (!round) return null;
  return (
    <div className="rounded-2xl bg-panel p-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider opacity-70">
        <span>Board · {round.bank} pts{round.multiplier > 1 ? ` · ×${round.multiplier}` : ""}</span>
        {(state.phase === "play" || state.phase === "steal") && <span className="text-strike">{"✕".repeat(round.strikes)}</span>}
      </div>
      <ol className="grid grid-cols-2 gap-1.5 text-sm">
        {round.board.map((slot, i) => (
          <li key={i} className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${slot.revealed ? "bg-tile-face text-tile-text" : "bg-black/30"} ${slot.auto ? "opacity-60" : ""}`}>
            <span className="truncate">{slot.revealed ? slot.text : i + 1}</span>
            {slot.revealed && <span className="ml-1 font-bold">{slot.points}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------ phases

function PhaseView({ state, me, act, serverNow }: { state: GameState; me: PublicPlayer; act: Act; serverNow: () => number }) {
  const turn = state.turn;
  const mine = !!turn?.playerIds.includes(me.id);
  const name = (id?: string) => state.players.find((p) => p.id === id)?.name ?? "Someone";
  const question = state.round && <p className="text-center text-lg font-semibold leading-snug">{state.round.question}</p>;

  switch (state.phase) {
    case "lobby":
      return <LobbyControls state={state} me={me} act={act} />;

    case "preparing":
      return <Big sub="The survey results are on their way. Eyes on the TV!">Get ready…</Big>;

    case "round_intro":
      return (
        <>
          <Big sub={question}>Round {state.roundIndex + 1}</Big>
        </>
      );

    case "faceoff":
      if (turn?.kind === "buzz") {
        return mine ? (
          <>
            {question}
            <BuzzButton onBuzz={() => act({ type: "buzz", turnId: turn.id })} />
            <p className="text-center text-sm opacity-70">You&apos;re in the face-off! First to buzz answers first.</p>
          </>
        ) : (
          <>
            {question}
            <Big sub="Watch the TV — first to buzz gets to answer.">
              {turn.playerIds.map(name).join(" vs ")}
            </Big>
          </>
        );
      }
      return mine && turn ? (
        <>
          {question}
          <AnswerBox key={turn.id} state={state} turnId={turn.id} act={act} serverNow={serverNow} prompt="Your face-off answer" />
        </>
      ) : (
        <>
          {question}
          <Big sub={turn?.judging ? `“${turn.judging.text}” — survey says…` : "Face-off in progress"}>{name(turn?.playerIds[0])} is answering</Big>
          <MiniBoard state={state} />
        </>
      );

    case "play_or_pass":
      return mine && turn ? (
        <>
          {question}
          <Big sub="Your team won the face-off. Play this board, or pass it to the other team?">Play or pass?</Big>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => act({ type: "play_pass", turnId: turn.id, choice: "play" })} className="font-display rounded-2xl bg-accent py-6 text-3xl text-black active:scale-95">
              PLAY
            </button>
            <button onClick={() => act({ type: "play_pass", turnId: turn.id, choice: "pass" })} className="font-display rounded-2xl bg-white/15 py-6 text-3xl active:scale-95">
              PASS
            </button>
          </div>
          <Countdown deadline={turn.deadline} total={TIMERS.playPass} serverNow={serverNow} size={52} />
        </>
      ) : (
        <>
          {question}
          <Big sub="Play or pass?">{name(turn?.playerIds[0])} is deciding</Big>
          <MiniBoard state={state} />
        </>
      );

    case "play": {
      const myTeamPlaying = turn?.team === me.team;
      return (
        <>
          {question}
          {mine && turn ? (
            <AnswerBox key={turn.id} state={state} turnId={turn.id} act={act} serverNow={serverNow} prompt="It's your turn!" />
          ) : (
            <Big sub={turn?.judging ? `“${turn.judging.text}” — survey says…` : myTeamPlaying ? "Help your teammate out (quietly)!" : "Your team might get to steal — start thinking!"}>
              {name(turn?.playerIds[0])}&apos;s turn
            </Big>
          )}
          <MiniBoard state={state} />
        </>
      );
    }

    case "steal":
      return (
        <>
          {question}
          {mine && turn ? (
            <AnswerBox
              key={turn.id}
              state={state}
              turnId={turn.id}
              act={act}
              serverNow={serverNow}
              total={TIMERS.steal}
              prompt="Steal! Agree on ONE answer with your team — anyone can submit it."
            />
          ) : (
            <Big sub={turn?.judging ? `“${turn.judging.text}” — survey says…` : "Fingers crossed…"}>The other team is trying to steal!</Big>
          )}
          <MiniBoard state={state} />
        </>
      );

    case "round_end": {
      const won = state.round?.winner === me.team;
      return (
        <>
          <Big sub={`+${state.round?.awarded ?? 0} points to ${state.teams[state.round?.winner ?? 0].name}`}>{won ? "Your team won the round! 🎉" : "The other team took this one"}</Big>
          <MiniBoard state={state} />
        </>
      );
    }

    case "game_over": {
      const won = state.winner === me.team;
      const isVip = state.vipId === me.id;
      return (
        <>
          <Big sub={state.recap}>{state.winner === "tie" ? "It's a tie!" : won ? "You won! 🏆" : "So close!"}</Big>
          {isVip && (
            <button onClick={() => act({ type: "play_again" })} className="font-display rounded-2xl bg-accent py-5 text-2xl text-black active:scale-95">
              Play again
            </button>
          )}
        </>
      );
    }
  }
}

function LobbyControls({ state, me, act }: { state: GameState; me: PublicPlayer; act: Act }) {
  const isVip = state.vipId === me.id;
  const enough = state.players.length >= LIMITS.minPlayersToStart;
  const [starting, setStarting] = useState(false);
  return (
    <>
      <Big sub="Look for your name on the TV.">You&apos;re in!</Big>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold opacity-80">Pick your team</span>
        <div className="grid grid-cols-2 gap-3">
          {([0, 1] as TeamIndex[]).map((t) => {
            const count = state.players.filter((p) => p.team === t).length;
            const selected = me.team === t;
            return (
              <button
                key={t}
                onClick={() => !selected && act({ type: "set_team", team: t })}
                className="rounded-2xl p-4 text-left transition active:scale-95"
                style={{
                  background: selected ? `var(--c-team-${t})` : "rgba(255,255,255,0.06)",
                  boxShadow: `inset 0 0 0 2px var(--c-team-${t})`,
                }}
              >
                <div className="font-display text-lg leading-tight">{state.teams[t].name}</div>
                <div className="text-sm opacity-80">
                  {count} player{count === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {isVip ? (
        <button
          disabled={!enough || starting}
          onClick={async () => {
            setStarting(true);
            await act({ type: "start" });
            setStarting(false);
          }}
          className="font-display mt-auto rounded-2xl bg-accent py-5 text-2xl text-black transition active:scale-95 disabled:opacity-40"
        >
          {enough ? (starting ? "Starting…" : "Everybody's in — start!") : `Waiting for ${LIMITS.minPlayersToStart - state.players.length} more…`}
        </button>
      ) : (
        <p className="mt-auto text-center text-sm opacity-70">⭐ {state.players.find((p) => p.id === state.vipId)?.name} (VIP) will start the game.</p>
      )}
    </>
  );
}

function BuzzButton({ onBuzz }: { onBuzz: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center">
      <button
        onPointerDown={() => {
          if (pressed) return;
          setPressed(true);
          navigator.vibrate?.(60);
          onBuzz();
        }}
        className="pulse-ring font-display grid size-64 place-items-center rounded-full text-5xl text-white transition active:scale-90"
        style={{
          background: "radial-gradient(circle at 35% 30%, #ff8a80, var(--c-strike) 55%, #7a0d06)",
          boxShadow: "0 14px 0 #5a0904, 0 20px 40px rgba(0,0,0,0.5)",
        }}
      >
        {pressed ? "…" : "BUZZ!"}
      </button>
    </div>
  );
}

function AnswerBox({
  state,
  turnId,
  act,
  serverNow,
  prompt,
  total,
}: {
  state: GameState;
  turnId: string;
  act: Act;
  serverNow: () => number;
  prompt: string;
  total?: number;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const judging = state.turn?.judging;

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sent) return;
    setSent(true);
    const ok = await act({ type: "answer", turnId, text });
    if (!ok) setSent(false);
  };

  if (judging || sent) {
    return <Big sub={`“${judging?.text ?? text}”`}>Survey says…</Big>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-panel p-4" style={{ boxShadow: "0 0 0 2px var(--c-accent)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-xl text-accent">{prompt}</span>
        {state.turn && <Countdown deadline={state.turn.deadline} total={total ?? state.settings.answerSeconds * 1000} serverNow={serverNow} size={48} />}
      </div>
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={LIMITS.answerLength}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="on"
        placeholder="Type your answer"
        className="rounded-xl border-2 border-white/15 bg-black/40 px-4 py-4 text-xl outline-none focus:border-accent"
      />
      <button disabled={!text.trim()} className="font-display rounded-xl bg-accent py-4 text-2xl text-black active:scale-95 disabled:opacity-40">
        Lock it in
      </button>
    </form>
  );
}
