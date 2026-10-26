"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { themeVars } from "@/components/theme-vars";
import { captionAt, splitCaptions } from "@/lib/captions";
import { seatKey, sendAction } from "@/lib/client/api";
import { FeudAudio, type Sfx } from "@/lib/client/audio";
import { HostVoice } from "@/lib/client/speech";
import { useGame, useNow } from "@/lib/client/use-game";
import { useStored } from "@/lib/client/use-stored";
import { DIFFICULTIES, difficultyOf } from "@/lib/difficulty";
import { activeDeadline, TIMERS } from "@/lib/engine";
import type { GameState } from "@/lib/types";
import { getPackTheme } from "@/packs";
import type { PackTheme } from "@/packs/types";
import { Backdrop } from "./backdrop";
import { StrikeOverlay } from "./board";
import { Stage } from "./stage";

interface Prefs {
  music: boolean;
  voice: boolean;
  three: boolean;
}

const DEFAULT_PREFS: Prefs = { music: true, voice: true, three: true };

function parsePrefs(raw: string | null): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(raw ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function HostScreen({ code }: { code: string }) {
  const live = useGame(code);
  const { state, apply, serverNow } = live;
  const theme = getPackTheme(state?.packId ?? "classic");
  const [onAir, setOnAir] = useState(false);
  const [rawPrefs, setRawPrefs] = useStored("feud:tv-prefs");
  const prefs = parsePrefs(rawPrefs);
  const [hostToken] = useStored(seatKey(code, "host"));
  const shaker = useRef<HTMLDivElement>(null);
  const audio = useRef<FeudAudio | null>(null);
  const voice = useRef<HostVoice | null>(null);
  const aiOn = !!live.meta?.ai;
  // The line the host is speaking (which can trail the newest line for a beat) and how far through it.
  const [caption, setCaption] = useState<Caption | null>(null);

  const act = useCallback(
    async (type: string, extra: Record<string, unknown> = {}) => {
      try {
        const res = await sendAction(code, { type, ...extra } as never, hostToken);
        apply(res.version, res.state, res.now);
      } catch (err) {
        if (type !== "tick" && type !== "line_done") console.warn(err);
      }
    },
    [code, hostToken, apply],
  );

  // The line the game is waiting on (a held turn, a guess being read out, or a round's intro): once the host has said it, the game moves on.
  const waitingOn = useRef<string | undefined>(undefined);
  const judging = state?.turn?.judging;
  const announcing = judging?.saidAt == null ? judging?.lineId : undefined;
  const waitingFor = state?.turn?.heldFor ?? announcing ?? (state?.phase === "round_intro" ? state.hostLine?.id : undefined);
  const announcingRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    waitingOn.current = waitingFor;
    announcingRef.current = announcing;
  }, [waitingFor, announcing]);

  const speakLine = useCallback(
    (line: { id: string; text: string }, silent = false) => {
      voice.current ??= new HostVoice(code);
      void voice.current.say(line, theme.voice, {
        ai: aiOn,
        token: hostToken,
        silent,
        onStart: () => audio.current?.duck(true),
        onEnd: () => audio.current?.duck(false),
        onDone: (done) => {
          // "…Survey says…" gets its drum roll, then the reveal.
          if (done.id === announcingRef.current) audio.current?.play("drumroll");
          if (hostToken && done.id === waitingOn.current) void act("line_done", { lineId: done.id });
        },
        onProgress: (spoken, fraction) =>
          setCaption((prev) => {
            const captions = prev?.id === spoken.id ? prev.captions : splitCaptions(spoken.text);
            const index = captionAt(captions, fraction);
            return prev?.id === spoken.id && prev.index === index ? prev : { id: spoken.id, captions, index };
          }),
      });
    },
    [code, hostToken, theme.voice, aiOn, act],
  );

  const updatePrefs = (patch: Partial<Prefs>) => setRawPrefs(JSON.stringify({ ...prefs, ...patch }));

  // Closing the TV window shuts the room, so nobody's left in an abandoned
  // game. A reload comes straight back and keeps it open.
  useEffect(() => {
    if (!hostToken) return;
    const leave = () => {
      void fetch(`/api/games/${code}/action`, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json", authorization: `Bearer ${hostToken}` },
        body: JSON.stringify({ type: "host_leaving" }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [code, hostToken]);
  const closesAt = state?.closesAt;
  useEffect(() => {
    if (closesAt && hostToken) void act("host_back");
  }, [closesAt, hostToken, act]);

  // The TV is the game clock: when a timer runs out, ask the server to advance.
  const deadline = state ? activeDeadline(state) : null;
  const phase = state?.phase;
  useEffect(() => {
    if (!deadline || phase === "game_over" || phase === "lobby" || phase === "closed") return;
    const wait = Math.max(0, deadline - serverNow()) + 250;
    const t = setTimeout(() => act("tick"), wait);
    // If the tick was a no-op (clock skew), try again shortly.
    const retry = setTimeout(() => act("tick"), wait + 3000);
    return () => {
      clearTimeout(t);
      clearTimeout(retry);
    };
  }, [deadline, phase, act, serverNow]);

  // Sound effects for each new event.
  const lastEvent = useRef<string | null>(null);
  useEffect(() => {
    const ev = state?.event;
    if (!ev || ev.id === lastEvent.current) return;
    const first = lastEvent.current === null;
    lastEvent.current = ev.id;
    if (first || !audio.current) return;
    const sfx: Partial<Record<string, Sfx>> = {
      join: "join",
      start: "sting",
      round_start: "sting",
      question: "whoosh",
      buzz: "buzz",
      miss: "strike",
      dupe: "strike",
      timeout: "strike",
      steal_miss: "strike",
      control: "whoosh",
      game_over: "win",
    };
    if (ev.kind === "hit" || ev.kind === "steal_hit") audio.current.play(ev.answerIndex === 0 ? "top" : "reveal");
    else if (sfx[ev.kind]) audio.current.play(sfx[ev.kind]!);
    if (["miss", "dupe", "timeout", "steal_miss"].includes(ev.kind)) {
      shaker.current?.animate(
        [
          { transform: "translate3d(0,0,0)" },
          { transform: "translate3d(-8px,3px,0)" },
          { transform: "translate3d(7px,-4px,0)" },
          { transform: "translate3d(-5px,2px,0)" },
          { transform: "translate3d(0,0,0)" },
        ],
        { duration: 450, easing: "ease-out" },
      );
    }
  }, [state?.event]);

  // Round-end: ding through the answers nobody found, matching the tile flips.
  const roundEndKey = phase === "round_end" ? `${state?.code}-${state?.roundIndex}` : null;
  const autoReveals = state?.round?.board.filter((s) => s.auto).length ?? 0;
  useEffect(() => {
    if (!roundEndKey) return;
    const autos = autoReveals;
    const timers = Array.from({ length: autos }, (_, i) => setTimeout(() => audio.current?.play("reveal"), 1600 + i * 650 + 300));
    timers.push(setTimeout(() => audio.current?.play("applause"), 400));
    return () => timers.forEach(clearTimeout);
  }, [roundEndKey, autoReveals]);

  // The host speaks every new line (or, with the voice off, captions it on a
  // clock). A line the AI is still writing waits, unless it takes too long.
  const lastLine = useRef<string | null>(null);
  const lineId = state?.hostLine?.id;
  const lineText = state?.hostLine?.text;
  const linePending = !!state?.hostLine?.pending;
  useEffect(() => {
    if (!lineId || lineText == null || lineId === lastLine.current) return;
    const speak = () => {
      lastLine.current = lineId;
      speakLine({ id: lineId, text: lineText }, !onAir || !prefs.voice);
    };
    if (!linePending) return speak();
    const t = setTimeout(speak, TIMERS.linePending);
    return () => clearTimeout(t);
  }, [lineId, lineText, linePending, onAir, prefs.voice, speakLine]);

  useEffect(() => {
    if (prefs.voice) return;
    voice.current?.stop();
    audio.current?.duck(false);
  }, [prefs.voice]);

  useEffect(() => {
    audio.current?.setMusicOn(prefs.music);
  }, [prefs.music]);

  const goOnAir = () => {
    audio.current ??= new FeudAudio();
    audio.current.unlock();
    audio.current.setMusicOn(prefs.music);
    setOnAir(true);
    // A line the AI is still writing gets spoken by the effect above once it's ready.
    if (prefs.voice && state?.hostLine && !state.hostLine.pending) speakLine(state.hostLine);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Start the score on air (and re-compose it if the pack changes); stop everything once the room closes.
  const ended = live.notFound || phase === "closed";
  useEffect(() => {
    if (ended) {
      audio.current?.stopMusic();
      voice.current?.stop();
    } else if (onAir) audio.current?.startMusic(theme.music, Date.now());
  }, [theme.music, onAir, ended]);

  useEffect(
    () => () => {
      audio.current?.stopMusic();
      voice.current?.stop();
    },
    [],
  );

  if (live.notFound || state?.phase === "closed") {
    const message = state?.phase === "closed" ? closedMessage(state.closed) : live.ended ? closedMessage(undefined) : `There's no game with code ${code}.`;
    return (
      <Centered>
        <p className="text-2xl">{message}</p>
        <Link href="/" className="rounded-xl bg-accent px-5 py-2 font-semibold text-black">
          Create a new game
        </Link>
      </Centered>
    );
  }
  if (!state) return <Centered><p className="text-xl opacity-70">Tuning in…</p></Centered>;

  return (
    <div style={themeVars(theme, state.teams)} className="fixed inset-0 overflow-hidden bg-bg text-ink">
      <Backdrop theme={theme} event={state.event} enable3d={prefs.three} />
      <div ref={shaker} className="absolute inset-0">
        <div className="camera-drift absolute inset-0">
          <Stage state={state} theme={theme} serverNow={serverNow} isHost={!!hostToken} onAction={(t, e) => act(t, e)} />
        </div>
      </div>
      <StrikeOverlay event={state.event} phase={state.phase} />
      <div className="tv-vignette absolute inset-0" />
      <div className="tv-scanlines absolute inset-0" />
      <TopBar state={state} theme={theme} connected={live.connected} serverNow={serverNow} />
      <Chyron theme={theme} caption={caption} line={state.hostLine?.pending ? null : state.hostLine} />
      <HostMenu prefs={prefs} onChange={updatePrefs} isHost={!!hostToken} onAction={act} state={state} />
      {hostToken && <EndSession onConfirm={() => act("close")} />}
      <AnimatePresence>{!onAir && <OnAirCurtain theme={theme} onStart={goOnAir} />}</AnimatePresence>
    </div>
  );
}

function closedMessage(reason: GameState["closed"]) {
  if (reason === "expired") return "This game room hit its one-hour limit and has closed.";
  if (reason === "host_left") return "The TV window was closed, so this game room has closed.";
  return "This game room has closed. Thanks for playing!";
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-8 text-center">{children}</div>;
}

/** A heads-up in the last few minutes before the room hits its time limit. */
function ClosingSoon({ createdAt, serverNow }: { createdAt: number; serverNow: () => number }) {
  useNow(10_000);
  const left = createdAt + TIMERS.session - serverNow();
  if (left > 5 * 60_000) return null;
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  return (
    <span className="rounded-md bg-strike/80 px-2 py-0.5 text-sm text-white">
      Room closes in {minutes} min
    </span>
  );
}

function TopBar({ state, theme, connected, serverNow }: { state: GameState; theme: PackTheme; connected: boolean; serverNow: () => number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-[2vw]">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 rounded-md bg-strike px-3 py-1 text-sm font-bold tracking-widest text-white">
          <span className={`size-2 rounded-full bg-white ${connected ? "animate-pulse" : "opacity-40"}`} /> LIVE
        </span>
        <span className="font-display text-[clamp(0.9rem,1.3vw,1.4rem)] opacity-90">{theme.name}</span>
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-sm">{DIFFICULTIES[difficultyOf(state.settings)].label}</span>
        {state.roundIndex >= 0 && state.phase !== "game_over" && (
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-sm">
            Round {state.roundIndex + 1}/{state.settings.rounds}
          </span>
        )}
        <ClosingSoon createdAt={state.createdAt} serverNow={serverNow} />
      </div>
      {state.phase !== "lobby" && (
        <div className="rounded-xl bg-panel px-4 py-2 text-right backdrop-blur">
          <div className="text-xs uppercase tracking-widest opacity-70">Join at /play</div>
          <div className="font-display text-2xl tracking-[0.2em] text-accent">{state.code}</div>
        </div>
      )}
    </div>
  );
}

interface Caption {
  id: string;
  captions: string[];
  index: number;
}

/** TV-style lower third: the host's words as closed captions, a sentence at a time, in step with the voice. */
function Chyron({ theme, caption, line }: { theme: PackTheme; caption: Caption | null; line: GameState["hostLine"] }) {
  const fallback = useMemo(() => (line ? splitCaptions(line.text) : []), [line]);
  const id = caption?.id ?? line?.id;
  const text = caption ? caption.captions[caption.index] : fallback[0];
  if (!id || !text) return null;
  const key = `${id}-${caption?.index ?? 0}`;
  return (
    <div className="pointer-events-none absolute inset-x-[4vw] bottom-[2.5vh] z-20">
      <motion.div
        key={id}
        initial={{ x: -30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="flex items-stretch overflow-hidden rounded-xl shadow-2xl"
      >
        <div className="font-display flex items-center gap-2 bg-accent px-4 text-[clamp(0.8rem,1.2vw,1.3rem)] uppercase text-black">
          <span className="text-[1.4em]">{theme.emoji}</span>
          {theme.hostName}
        </div>
        <div className="flex min-h-[2.2em] flex-1 items-center bg-panel px-5 py-3 text-[clamp(1.1rem,1.9vw,2.1rem)] leading-snug backdrop-blur">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.14 }}
            >
              {text}
            </motion.span>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function OnAirCurtain({ theme, onStart }: { theme: PackTheme; onStart: () => void }) {
  return (
    <motion.button
      onClick={onStart}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black/80 backdrop-blur-sm"
    >
      <div className="font-display text-[clamp(2.5rem,6vw,6rem)] text-glow">{theme.name}</div>
      <div className="font-display rounded-2xl bg-accent px-8 py-4 text-2xl text-black">▶ Go on air</div>
      <div className="max-w-md text-sm opacity-70">Click to start the music and the host&apos;s voice, and go fullscreen. Put this screen on the TV.</div>
    </motion.button>
  );
}

function HostMenu({
  prefs,
  onChange,
  isHost,
  onAction,
  state,
}: {
  prefs: Prefs;
  onChange: (p: Partial<Prefs>) => void;
  isHost: boolean;
  onAction: (type: string) => void;
  state: GameState;
}) {
  const [open, setOpen] = useState(false);
  const inGame = !["lobby", "game_over"].includes(state.phase);
  return (
    <div className="absolute bottom-[14vh] right-[1.5vw] z-40 flex flex-col items-end gap-2 opacity-30 transition hover:opacity-100">
      {open && (
        <div className="flex flex-col gap-1 rounded-xl bg-panel p-2 text-sm backdrop-blur">
          <Toggle label="Music" on={prefs.music} onClick={() => onChange({ music: !prefs.music })} />
          <Toggle label="Host voice" on={prefs.voice} onClick={() => onChange({ voice: !prefs.voice })} />
          <Toggle label="3D scene" on={prefs.three} onClick={() => onChange({ three: !prefs.three })} />
          <button className="rounded-lg px-3 py-1.5 text-left hover:bg-white/10" onClick={() => document.documentElement.requestFullscreen?.()}>
            Fullscreen
          </button>
          {isHost && inGame && (
            <>
              <button className="rounded-lg px-3 py-1.5 text-left hover:bg-white/10" onClick={() => onAction("skip")}>
                Skip ahead ⏭
              </button>
              <button className="rounded-lg px-3 py-1.5 text-left hover:bg-white/10" onClick={() => confirm("Finish this game and go to the final scores?") && onAction("end")}>
                Finish game (final scores)
              </button>
            </>
          )}
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} className="grid size-10 place-items-center rounded-full bg-panel text-lg backdrop-blur" aria-label="Show settings">
        ⚙︎
      </button>
    </div>
  );
}

/** Always on hand: shut the room down for everyone, after a confirmation. */
function EndSession({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-[14vh] right-[calc(1.5vw+3rem)] z-40 h-10 rounded-full bg-panel px-4 text-sm font-semibold opacity-30 backdrop-blur transition hover:opacity-100"
      >
        End session
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
            onClick={() => !busy && setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="end-session-title"
              onClick={(e) => e.stopPropagation()}
              className="flex max-w-md flex-col gap-4 rounded-2xl bg-bg p-6 shadow-2xl"
              style={{ boxShadow: "0 0 0 2px var(--c-strike)" }}
            >
              <h2 id="end-session-title" className="font-display text-2xl">
                End this game room?
              </h2>
              <p className="opacity-80">
                The game stops for everyone, every phone is disconnected, and the room code stops working. This can&apos;t be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button autoFocus disabled={busy} onClick={() => setOpen(false)} className="rounded-xl bg-white/10 px-4 py-2 font-semibold hover:bg-white/20">
                  Keep playing
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onConfirm();
                    setBusy(false);
                    setOpen(false);
                  }}
                  className="rounded-xl bg-strike px-4 py-2 font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "Ending…" : "End session"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between gap-6 rounded-lg px-3 py-1.5 hover:bg-white/10">
      {label}
      <span className={`h-5 w-9 rounded-full p-0.5 transition ${on ? "bg-accent" : "bg-white/20"}`}>
        <span className={`block size-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}
