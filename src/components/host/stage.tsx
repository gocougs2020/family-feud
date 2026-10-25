"use client";

import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Countdown } from "@/components/countdown";
import { LIMITS, TIMERS } from "@/lib/engine";
import type { GameState, TeamIndex } from "@/lib/types";
import type { PackTheme } from "@/packs/types";
import { Bank, Board, GuessBubble, PlayerChip, StrikeTally, TeamPodium } from "./board";

interface StageProps {
  state: GameState;
  theme: PackTheme;
  serverNow: () => number;
  isHost: boolean;
  onAction: (type: "start" | "play_again" | "kick", extra?: Record<string, unknown>) => void;
}

const fade = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(8px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 1.03, filter: "blur(8px)" },
  transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] as const },
};

export function Stage(props: StageProps) {
  const { state } = props;
  const view =
    state.phase === "lobby"
      ? "lobby"
      : state.phase === "preparing"
        ? "preparing"
        : state.phase === "round_intro"
          ? `intro-${state.roundIndex}`
          : state.phase === "game_over"
            ? "over"
            : `board-${state.roundIndex}`;
  return (
    <AnimatePresence mode="wait">
      <motion.div key={view} {...fade} className="absolute inset-0 flex flex-col px-[4vw] pb-[13vh] pt-[9vh]">
        {view === "lobby" && <Lobby {...props} />}
        {view === "preparing" && <Preparing {...props} />}
        {view.startsWith("intro") && <RoundIntro {...props} />}
        {view.startsWith("board") && <BoardView {...props} />}
        {view === "over" && <GameOver {...props} />}
      </motion.div>
    </AnimatePresence>
  );
}

// ------------------------------------------------------------ lobby

function useJoinUrl(code: string) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => null,
  );
  const url = origin ? `${origin}/play/${code}` : null;
  const [qr, setQr] = useState<string>("");
  useEffect(() => {
    if (url) QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0b0b14", light: "#ffffff" } }).then(setQr);
  }, [url]);
  return { url, qr, local: url ? /localhost|127\.0\.0\.1/.test(url) : false };
}

function Lobby({ state, theme, isHost, onAction }: StageProps) {
  const { url, qr, local } = useJoinUrl(state.code);
  const vip = state.players.find((p) => p.id === state.vipId);
  const canStart = state.players.length >= LIMITS.minPlayersToStart;
  return (
    <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-[4vw]">
      <div className="flex flex-col items-start gap-6">
        <div className="text-[clamp(1rem,1.6vw,1.6rem)] uppercase tracking-[0.3em] text-accent">{theme.tagline}</div>
        <h1 className="font-display text-[clamp(2.6rem,6vw,6.5rem)] leading-[0.95] text-glow">{theme.name}</h1>
        {state.topic && <div className="text-[clamp(1.2rem,2vw,2rem)] opacity-90">Topic: “{state.topic}”</div>}
        <div className="flex items-center gap-6 rounded-3xl bg-panel p-5 backdrop-blur" style={{ boxShadow: "0 0 0 2px var(--c-accent-soft)" }}>
          <div className="size-[clamp(8rem,14vw,14rem)] overflow-hidden rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="flex flex-col gap-2">
            <div className="text-[clamp(0.9rem,1.3vw,1.3rem)] opacity-75">Scan, or go to</div>
            <div className="font-mono text-[clamp(1rem,1.6vw,1.6rem)] font-semibold">{url?.replace(/^https?:\/\//, "").replace(/\/play\/.*/, "/play")}</div>
            <div className="text-[clamp(0.9rem,1.3vw,1.3rem)] opacity-75">and enter code</div>
            <div className="font-display text-[clamp(3rem,6vw,6rem)] leading-none tracking-[0.15em] text-accent text-glow">{state.code}</div>
          </div>
        </div>
        {local && (
          <p className="max-w-xl rounded-xl bg-strike/20 px-3 py-1.5 text-xs leading-snug">
            Phones can&apos;t open <b>localhost</b>. Open this screen using your computer&apos;s network address (e.g.
            http://192.168.x.x:3000) so the QR code works, or deploy to Vercel.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          {([0, 1] as TeamIndex[]).map((team) => (
            <div key={team} className="flex min-h-[38vh] flex-col gap-3 rounded-3xl bg-panel p-5 backdrop-blur" style={{ boxShadow: `inset 0 3px 0 var(--c-team-${team})` }}>
              <div className="font-display text-[clamp(1.2rem,2.2vw,2.4rem)] uppercase" style={{ color: `var(--c-team-${team})` }}>
                {state.teams[team].name}
              </div>
              <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {state.players
                    .filter((p) => p.team === team)
                    .map((p) => (
                      <motion.button
                        key={p.id}
                        layout
                        initial={{ opacity: 0, scale: 0.4, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        title={isHost ? "Click to remove" : undefined}
                        onClick={() => isHost && confirm(`Remove ${p.name}?`) && onAction("kick", { playerId: p.id })}
                        className="cursor-default"
                      >
                        <PlayerChip player={p} highlight={p.id === state.vipId} />
                      </motion.button>
                    ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4 text-[clamp(1rem,1.5vw,1.5rem)]">
          <span className="opacity-85">
            {state.players.length === 0
              ? "Waiting for players to join…"
              : vip
                ? `⭐ ${vip.name} is the VIP — start the game from your phone when everyone's in.`
                : ""}
          </span>
          {isHost && (
            <button
              disabled={!canStart}
              onClick={() => onAction("start")}
              className="font-display shrink-0 rounded-2xl bg-accent px-6 py-3 text-xl text-black transition enabled:hover:scale-105 disabled:opacity-40"
            >
              Start game
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Preparing({ theme }: StageProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <motion.div
        className="text-[clamp(4rem,10vw,10rem)]"
        animate={{ rotate: [0, 12, -12, 0], y: [0, -12, 0] }}
        transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
      >
        {theme.scene === "great-hall" ? "🦉" : "📋"}
      </motion.div>
      <div className="font-display text-[clamp(2rem,4vw,4.5rem)] text-glow">Tallying the survey…</div>
      <div className="text-[clamp(1rem,1.6vw,1.6rem)] opacity-75">We asked {theme.audienceLabel}. Results are on their way.</div>
    </div>
  );
}

// ------------------------------------------------------------ round intro

function RoundIntro({ state, theme }: StageProps) {
  const round = state.round!;
  const last = state.roundIndex === state.settings.rounds - 1;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[4vh] text-center">
      <motion.div
        initial={{ scale: 3, opacity: 0, rotateX: 80 }}
        animate={{ scale: 1, opacity: 1, rotateX: 0 }}
        transition={{ type: "spring", stiffness: 90, damping: 12 }}
        className="font-display text-[clamp(4rem,11vw,12rem)] leading-none text-glow"
      >
        {last ? "FINAL ROUND" : `ROUND ${state.roundIndex + 1}`}
      </motion.div>
      {round.multiplier > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="font-display rounded-xl bg-accent px-6 py-2 text-[clamp(1.4rem,2.6vw,2.8rem)] text-black"
        >
          {round.multiplier === 2 ? "DOUBLE POINTS" : "TRIPLE POINTS"}
        </motion.div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.6, duration: 0.8 }}
        className="max-w-[70vw] text-[clamp(0.9rem,1.5vw,1.6rem)] uppercase tracking-[0.25em] text-accent"
      >
        We surveyed {theme.audienceLabel}…
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.4, duration: 0.8 }}
        className="font-display max-w-[80vw] text-[clamp(1.8rem,3.8vw,4.2rem)] leading-tight"
      >
        {round.question}
      </motion.div>
    </div>
  );
}

// ------------------------------------------------------------ board

function TurnBanner({ state, serverNow }: StageProps) {
  const turn = state.turn;
  const names = (ids: string[]) =>
    ids.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join(" vs ");
  let label = "";
  let total: number = state.settings.answerSeconds * 1000;
  if (state.phase === "faceoff" && turn?.kind === "buzz") {
    label = `FACE-OFF: ${names(turn.playerIds)} — buzz in!`;
    total = TIMERS.buzz;
  } else if (turn?.kind === "faceoff_answer") label = `${names(turn.playerIds)}, your answer?`;
  else if (turn?.kind === "play_pass") {
    label = `${names(turn.playerIds)}: play or pass?`;
    total = TIMERS.playPass;
  } else if (turn?.kind === "answer") label = `${names(turn.playerIds)} is up for ${state.teams[turn.team ?? 0].name}`;
  else if (turn?.kind === "steal") {
    label = `${state.teams[turn.team ?? 0].name}: confer and steal!`;
    total = TIMERS.steal;
  } else if (state.phase === "round_end" && state.round?.winner != null) {
    label = `${state.teams[state.round.winner].name} win ${state.round.awarded} points!`;
  }
  if (!label) return <div className="h-[clamp(3rem,5vw,4.5rem)]" />;
  const team = turn?.team ?? state.round?.winner ?? null;
  return (
    <motion.div
      key={label}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-[clamp(3rem,5vw,4.5rem)] items-center justify-center gap-4"
    >
      <span
        className="font-display rounded-full px-6 py-2 text-[clamp(1.1rem,2vw,2.2rem)] uppercase"
        style={{ background: team != null ? `var(--c-team-${team})` : "var(--c-accent)", color: "#fff", textShadow: "0 2px 0 rgba(0,0,0,0.35)" }}
      >
        {label}
      </span>
      {turn && !turn.judging && <Countdown deadline={turn.deadline} total={total} serverNow={serverNow} size={56} />}
    </motion.div>
  );
}

function BoardView(props: StageProps) {
  const { state } = props;
  const round = state.round!;
  const activeTeam = state.turn?.team ?? round.control;
  return (
    <div className="flex flex-1 flex-col gap-[2.5vh]">
      <div className="mx-auto max-w-[80vw] text-center font-display text-[clamp(1.1rem,2.2vw,2.4rem)] leading-tight">{round.question}</div>
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,4.2fr)_minmax(0,1fr)] items-center gap-[2vw]">
        <TeamPodium state={state} team={0} active={activeTeam === 0} />
        <div className="flex flex-col gap-[1.5vh]">
          <div className="flex items-center justify-between">
            <div className="w-[10vw]">{state.phase === "play" || state.phase === "steal" ? <StrikeTally strikes={round.strikes} /> : null}</div>
            <Bank round={round} />
            <div className="w-[10vw]" />
          </div>
          <div className="relative">
            <Board round={round} />
            <div className="absolute inset-x-0 bottom-0 z-10 flex translate-y-1/3 justify-center">
              <GuessBubble state={state} />
            </div>
          </div>
        </div>
        <TeamPodium state={state} team={1} active={activeTeam === 1} />
      </div>
      <TurnBanner {...props} />
    </div>
  );
}

// ------------------------------------------------------------ game over

function GameOver({ state, isHost, onAction }: StageProps) {
  const winner = state.winner;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[4vh] text-center">
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 70, damping: 10 }}
        className="font-display text-[clamp(3rem,8vw,9rem)] leading-none text-glow"
        style={{ color: winner === "tie" || winner == null ? undefined : `var(--c-team-${winner})` }}
      >
        {winner === "tie" ? "IT'S A TIE!" : winner != null ? `${state.teams[winner].name} WIN!` : "GAME OVER"}
      </motion.div>
      <div className="flex gap-[6vw]">
        {([0, 1] as TeamIndex[]).map((t) => (
          <div key={t} className="flex flex-col items-center gap-2">
            <div className="font-display text-[clamp(1.2rem,2vw,2.2rem)] uppercase" style={{ color: `var(--c-team-${t})` }}>
              {state.teams[t].name}
            </div>
            <div className="font-display text-[clamp(3rem,6vw,6.5rem)] leading-none">{state.teams[t].score}</div>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {state.recap && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-[60vw] text-[clamp(1rem,1.7vw,1.8rem)] italic opacity-90">
            {state.recap}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-4 text-[clamp(0.9rem,1.4vw,1.4rem)] opacity-80">
        The VIP can start another game from their phone.
        {isHost && (
          <button onClick={() => onAction("play_again")} className="font-display rounded-2xl bg-accent px-6 py-3 text-xl text-black opacity-100 hover:scale-105">
            Play again
          </button>
        )}
      </div>
    </div>
  );
}
