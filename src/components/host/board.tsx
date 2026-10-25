"use client";

import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import type { BoardSlot, GameEvent, GameState, PublicPlayer, RoundState, TeamIndex } from "@/lib/types";

// ------------------------------------------------------------ numbers

export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, { stiffness: 80, damping: 18 });
  const text = useTransform(spring, (v) => Math.round(v).toString());
  useEffect(() => spring.set(value), [spring, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

// ------------------------------------------------------------ tiles

function Tile({ slot, number, delay }: { slot: BoardSlot | null; number: number; delay: number }) {
  if (!slot) {
    return <div className="h-full rounded-[0.6rem] border-2 border-white/5 bg-black/35 shadow-inner" />;
  }
  return (
    <div className="tile h-full [container-type:size]" data-revealed={slot.revealed}>
      <div className="tile-inner" style={{ transitionDelay: slot.auto ? `${delay}ms` : "0ms" }}>
        <div className="tile-face tile-front grid place-items-center">
          <span
            className="font-display grid h-[62%] aspect-[1.6] place-items-center rounded-[50%] text-[42cqh] text-white"
            style={{
              background: "radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--c-tile) 50%, white), var(--c-tile))",
              boxShadow: "inset 0 0 0 2px var(--c-tile-edge), 0 0 18px rgba(0,0,0,0.5)",
            }}
          >
            {number}
          </span>
        </div>
        <div className="tile-face tile-back tile-revealed flex items-center" data-auto={slot.auto ? "true" : "false"}>
          <span className="font-display flex-1 truncate px-[4%] text-left text-[min(38cqh,5.4cqw)] uppercase leading-none">
            {slot.text}
          </span>
          <span
            className="font-display grid h-full w-[20%] place-items-center rounded-r-[0.6rem] text-[min(44cqh,8cqw)]"
            style={{ background: "rgba(0,0,0,0.18)", boxShadow: "inset 3px 0 0 var(--c-tile-edge)" }}
          >
            {slot.points}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Board({ round }: { round: RoundState }) {
  const rows = Math.max(4, Math.ceil(round.board.length / 2));
  const cells: (BoardSlot | null)[] = Array.from({ length: rows * 2 }, (_, i) => round.board[i] ?? null);
  const autoOrder = round.board.map((s, i) => (s.auto ? i : -1)).filter((i) => i >= 0);
  // Classic layout: 1-4 down the left column, 5-8 down the right.
  const ordered = Array.from({ length: rows * 2 }, (_, k) => {
    const row = Math.floor(k / 2);
    const col = k % 2;
    return col === 0 ? row : rows + row;
  });
  return (
    <div
      className="grid grid-cols-2 gap-[1.2%] rounded-2xl p-[1.4%]"
      style={{
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        aspectRatio: "16 / 7",
        width: "min(100%, calc(44vh * 16 / 7))",
        marginInline: "auto",
        background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.75))",
        boxShadow: "inset 0 0 0 4px var(--c-tile-edge), 0 0 0 10px rgba(0,0,0,0.45), 0 30px 80px rgba(0,0,0,0.6)",
      }}
    >
      {ordered.map((index) => (
        <Tile key={index} slot={cells[index]} number={index + 1} delay={1600 + autoOrder.indexOf(index) * 650} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------ chrome

export function Bank({ round }: { round: RoundState }) {
  return (
    <div className="flex items-center justify-center gap-4">
      <div
        className="font-display min-w-[7ch] rounded-xl px-6 py-1 text-center text-[clamp(2rem,4.5vw,4.5rem)] leading-tight text-glow"
        style={{ background: "linear-gradient(180deg, var(--c-tile), rgba(0,0,0,0.6))", boxShadow: "inset 0 0 0 3px var(--c-tile-edge)" }}
      >
        <AnimatedNumber value={round.bank} />
      </div>
      {round.multiplier > 1 && (
        <div className="font-display rounded-lg bg-accent px-3 py-1 text-[clamp(1rem,1.8vw,1.8rem)] text-black">
          {round.multiplier === 2 ? "DOUBLE" : "TRIPLE"}
        </div>
      )}
    </div>
  );
}

export function TeamPodium({
  state,
  team,
  active,
}: {
  state: GameState;
  team: TeamIndex;
  active: boolean;
}) {
  const t = state.teams[team];
  const players = state.players.filter((p) => p.team === team);
  return (
    <motion.div
      animate={{ scale: active ? 1.05 : 1, opacity: active || state.round?.control == null ? 1 : 0.75 }}
      className="flex w-full flex-col items-center gap-3 rounded-2xl bg-panel p-4 backdrop-blur"
      style={{
        boxShadow: active
          ? `0 0 0 3px var(--c-team-${team}), 0 0 50px color-mix(in srgb, var(--c-team-${team}) 55%, transparent)`
          : "0 0 0 1px rgba(255,255,255,0.12)",
      }}
    >
      <div className="font-display text-center text-[clamp(0.9rem,1.5vw,1.6rem)] uppercase leading-tight" style={{ color: `var(--c-team-${team})` }}>
        {t.name}
      </div>
      <AnimatedNumber value={t.score} className="font-display text-[clamp(2.2rem,4.8vw,5rem)] leading-none text-glow" />
      <div className="flex flex-wrap justify-center gap-1.5">
        {players.map((p) => (
          <PlayerChip key={p.id} player={p} highlight={state.turn?.playerIds.includes(p.id) ?? false} small />
        ))}
      </div>
    </motion.div>
  );
}

export function PlayerChip({ player, highlight, small }: { player: PublicPlayer; highlight?: boolean; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${small ? "px-2 py-0.5 text-[clamp(0.65rem,0.9vw,0.95rem)]" : "px-3 py-1 text-lg"} font-semibold transition`}
      style={{
        background: highlight ? player.color : "rgba(255,255,255,0.08)",
        color: highlight ? "#111" : "var(--c-text)",
        boxShadow: highlight ? `0 0 16px ${player.color}` : undefined,
      }}
    >
      <span className="inline-block size-2 rounded-full" style={{ background: highlight ? "#111" : player.color }} />
      {player.name}
    </span>
  );
}

// ------------------------------------------------------------ strikes + guesses

const STRIKE_EVENTS = new Set<GameEvent["kind"]>(["miss", "dupe", "timeout", "steal_miss"]);

/** Big red X's that slam onto the screen after a wrong answer. */
export function StrikeOverlay({ event, phase }: { event: GameEvent | null; phase: GameState["phase"] }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const isStrike = !!event && STRIKE_EVENTS.has(event.kind);
  const eventId = event?.id;
  useEffect(() => {
    if (!eventId || !isStrike) return;
    const t = setTimeout(() => setDismissed(eventId), 1700);
    return () => clearTimeout(t);
  }, [eventId, isStrike]);
  const count = phase === "play" || phase === "steal" ? (event?.strikes ?? 1) : 1;
  const shown = event && isStrike && dismissed !== event.id ? { id: event.id, count: Math.min(3, Math.max(1, count)) } : null;
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.id}
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-[2vw]"
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          {Array.from({ length: shown.count }, (_, i) => (
            <span key={i} className="strike-x font-display text-[clamp(8rem,22vw,22rem)] leading-none" style={{ animationDelay: `${i * 0.08}s` }}>
              ✕
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function StrikeTally({ strikes }: { strikes: number }) {
  return (
    <div className="flex gap-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="font-display grid size-[clamp(2rem,3.4vw,3.4rem)] place-items-center rounded-lg text-[clamp(1.4rem,2.4vw,2.6rem)]"
          style={{
            background: i < strikes ? "var(--c-strike)" : "rgba(255,255,255,0.06)",
            color: i < strikes ? "#fff" : "rgba(255,255,255,0.2)",
            boxShadow: i < strikes ? "0 0 22px var(--c-strike)" : "inset 0 0 0 2px rgba(255,255,255,0.12)",
          }}
        >
          ✕
        </span>
      ))}
    </div>
  );
}

/** "Survey says…" speech bubble for the guess being judged, then its result. */
export function GuessBubble({ state }: { state: GameState }) {
  const judging = state.turn?.judging;
  const event = state.event;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const isResult = !!event?.text && ["hit", "miss", "dupe", "steal_hit", "steal_miss"].includes(event.kind);
  const eventId = event?.id;
  useEffect(() => {
    if (!eventId || !isResult) return;
    const t = setTimeout(() => setDismissed(eventId), 2600);
    return () => clearTimeout(t);
  }, [eventId, isResult]);
  const recent =
    event && isResult && dismissed !== event.id
      ? { id: event.id, text: event.text!, name: state.players.find((p) => p.id === event.playerId)?.name ?? "", result: event.kind }
      : null;

  const name = judging ? (state.players.find((p) => p.id === judging.playerId)?.name ?? "") : recent?.name;
  const text = judging?.text ?? recent?.text;
  const good = recent && (recent.result === "hit" || recent.result === "steal_hit");
  return (
    <AnimatePresence mode="wait">
      {text && (
        <motion.div
          key={judging ? `j-${text}` : recent?.id}
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex items-center gap-4 rounded-2xl bg-panel px-6 py-3 backdrop-blur"
          style={{ boxShadow: `0 0 0 2px ${judging ? "var(--c-accent)" : good ? "var(--c-accent)" : "var(--c-strike)"}` }}
        >
          <span className="text-[clamp(0.9rem,1.4vw,1.4rem)] opacity-70">{name} says</span>
          <span className="font-display text-[clamp(1.4rem,2.6vw,2.8rem)] uppercase">“{text}”</span>
          {judging ? (
            <motion.span
              className="font-display text-[clamp(1rem,1.6vw,1.6rem)] text-accent"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ repeat: Infinity, duration: 0.9 }}
            >
              SURVEY SAYS…
            </motion.span>
          ) : (
            <span className={`font-display text-[clamp(1rem,1.6vw,1.6rem)] ${good ? "text-accent" : "text-strike"}`}>
              {good ? "ON THE BOARD!" : recent?.result === "dupe" ? "ALREADY UP THERE" : "NOT THERE!"}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
