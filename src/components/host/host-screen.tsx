"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { themeVars } from "@/components/theme-vars";
import { captionAt, splitCaptions } from "@/lib/captions";
import { seatKey, sendAction } from "@/lib/client/api";
import { FeudAudio, type Sfx } from "@/lib/client/audio";
import { HostVoice } from "@/lib/client/speech";
import { useGame } from "@/lib/client/use-game";
import { useStored } from "@/lib/client/use-stored";
import { activeDeadline } from "@/lib/engine";
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

  const speakLine = useCallback(
    (line: { id: string; text: string }, silent = false) => {
      voice.current ??= new HostVoice(code);
      void voice.current.say(line, theme.voice, {
        ai: aiOn,
        token: hostToken,
        silent,
        onStart: () => audio.current?.duck(true),
        onEnd: () => audio.current?.duck(false),
        onProgress: (spoken, fraction) =>
          setCaption((prev) => {
            const captions = prev?.id === spoken.id ? prev.captions : splitCaptions(spoken.text);
            const index = captionAt(captions, fraction);
            return prev?.id === spoken.id && prev.index === index ? prev : { id: spoken.id, captions, index };
          }),
      });
    },
    [code, hostToken, theme.voice, aiOn],
  );

  const updatePrefs = (patch: Partial<Prefs>) => setRawPrefs(JSON.stringify({ ...prefs, ...patch }));

  const act = useCallback(
    async (type: string, extra: Record<string, unknown> = {}) => {
      try {
        const res = await sendAction(code, { type, ...extra } as never, hostToken);
        apply(res.version, res.state, res.now);
      } catch (err) {
        if (type !== "tick") console.warn(err);
      }
    },
    [code, hostToken, apply],
  );

  // The TV is the game clock: when a timer runs out, ask the server to advance.
  const deadline = state ? activeDeadline(state) : null;
  const phase = state?.phase;
  useEffect(() => {
    if (!deadline || phase === "game_over" || phase === "lobby") return;
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
      buzz: "buzz",
      judging: "drumroll",
      miss: "strike",
      dupe: "strike",
      timeout: "strike",
      steal_miss: "strike",
      control: "whoosh",
      game_over: "win",
    };
    if (ev.kind === "hit" || ev.kind === "steal_hit") audio.current.play(ev.answerIndex === 0 ? "top" : "reveal");
    else if (sfx[ev.kind]) audio.current.play(sfx[ev.kind]!);
    // A face-off buzz arrives with its answer already locked in.
    if (ev.kind === "buzz" && ev.text) {
      const t = setTimeout(() => audio.current?.play("drumroll"), 700);
      return () => clearTimeout(t);
    }
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

  // The host speaks every new line (or, with the voice off, captions it on a clock).
  const lastLine = useRef<string | null>(null);
  useEffect(() => {
    const line = state?.hostLine;
    if (!line || line.id === lastLine.current) return;
    lastLine.current = line.id;
    speakLine(line, !onAir || !prefs.voice);
  }, [state?.hostLine, onAir, prefs.voice, speakLine]);

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
    if (prefs.voice && state?.hostLine) speakLine(state.hostLine);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Start the score on air (and re-compose it if the pack changes).
  useEffect(() => {
    if (onAir) audio.current?.startMusic(theme.music, Date.now());
  }, [theme.music, onAir]);

  useEffect(
    () => () => {
      audio.current?.stopMusic();
      voice.current?.stop();
    },
    [],
  );

  if (live.notFound) {
    return (
      <Centered>
        <p className="text-2xl">There&apos;s no game with code {code}.</p>
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
      <TopBar state={state} theme={theme} connected={live.connected} />
      <Chyron theme={theme} caption={caption} line={state.hostLine} />
      <HostMenu prefs={prefs} onChange={updatePrefs} isHost={!!hostToken} onAction={act} state={state} />
      <AnimatePresence>{!onAir && <OnAirCurtain theme={theme} onStart={goOnAir} />}</AnimatePresence>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-8 text-center">{children}</div>;
}

function TopBar({ state, theme, connected }: { state: GameState; theme: PackTheme; connected: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-[2vw]">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 rounded-md bg-strike px-3 py-1 text-sm font-bold tracking-widest text-white">
          <span className={`size-2 rounded-full bg-white ${connected ? "animate-pulse" : "opacity-40"}`} /> LIVE
        </span>
        <span className="font-display text-[clamp(0.9rem,1.3vw,1.4rem)] opacity-90">{theme.name}</span>
        {state.roundIndex >= 0 && state.phase !== "game_over" && (
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-sm">
            Round {state.roundIndex + 1}/{state.settings.rounds}
          </span>
        )}
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
              <button className="rounded-lg px-3 py-1.5 text-left text-strike hover:bg-white/10" onClick={() => confirm("End the game now?") && onAction("end")}>
                End game
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
