"use client";

import { estimateSpeechMs, partShares, plainText, VOICE_SPEED, voiceParts } from "@/lib/captions";
import type { PackTheme } from "@/packs/types";

// The host's voice. When AI is on, the TV fetches each line from the AI
// Gateway (fish-audio/drama-3) via /api/games/[code]/voice, a sentence at a
// time: every sentence is asked for at once, the first plays the moment it
// arrives, and the rest follow on. Otherwise, or if that's slow or fails, it
// uses the browser's built-in speech synthesis. Either way it reports how far
// through the line it is, so the TV can show captions in step with the voice.

type Voice = PackTheme["voice"];
type Line = { id: string; text: string };
interface Hooks {
  onStart?: () => void;
  onEnd?: () => void;
  /** how much of `line` has been spoken, 0–1 */
  onProgress?: (line: Line, fraction: number) => void;
  /** `line` has been said in full (not called for a line cut short by the next one) */
  onDone?: (line: Line) => void;
}
/** A voiced sentence, and the rate the server says to play it at. */
type Clip = { blob: Blob; rate: number };

/**
 * A line this close to finishing gets to finish before the next one starts;
 * a longer one fades out rather than stopping dead.
 */
const WAIT_MS = 4000;
const FADE_MS = 350;
/** how long to wait for a sentence's voice before giving up on it */
const CLIP_TIMEOUT_MS = 9000;
/** recent sentences kept by their text, so one that comes up again ("Survey says…") plays at once */
const MAX_CLIPS = 24;

class StaleLine extends Error {}

function chooseVoice(cfg: Voice): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  for (const name of cfg.preferNames) {
    const match = voices.find((v) => v.name.includes(name) && v.lang.startsWith(cfg.lang.slice(0, 2)));
    if (match) return match;
  }
  return voices.find((v) => v.lang === cfg.lang) ?? voices.find((v) => v.lang.startsWith(cfg.lang.slice(0, 2))) ?? null;
}

export class HostVoice {
  private audio: HTMLAudioElement | null = null;
  private request: AbortController | null = null;
  private url: string | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** when the browser voice should finish the current line (estimated) */
  private speechEndsAt = 0;
  /** roughly how long the current line's sentences after the one playing will take */
  private restMs = 0;
  /** bumped by every new line, so stale async work can tell it lost */
  private generation = 0;
  /** bumped whenever playback stops or starts fading, so a line's later sentences don't play after it */
  private playback = 0;
  /** ends the wait on the sentence playing now, when playback is stopped */
  private settle: (() => void) | null = null;
  /** true while a line's sentences are being played */
  private playing = false;
  /** AI voice failures in a row; after a few we stop retrying every line */
  private aiFailures = 0;
  private clips = new Map<string, Clip>();

  constructor(private code: string) {}

  /** Speak a line, or with `silent`, just run its captions on an estimated clock. */
  async say(line: Line, cfg: Voice, opts: { ai: boolean; token: string | null; silent?: boolean } & Hooks) {
    const gen = ++this.generation;
    this.request?.abort();
    this.request = null;

    const parts = voiceParts(line.text);
    if (!opts.silent && opts.ai && opts.token && this.aiFailures < 3 && parts.length) {
      const controller = new AbortController();
      this.request = controller;
      const clips = parts.map((part, i) => this.clip(line.id, i, part, opts.token!, controller.signal));
      // A later sentence that fails is handled when its turn comes.
      clips.forEach((clip) => clip.catch(() => {}));
      try {
        await clips[0];
        if (gen !== this.generation) return;
        this.aiFailures = 0;
        await this.handOff();
        if (gen !== this.generation) return;
        this.stopPlayback();
        void this.playParts(line, parts, clips, cfg, opts);
        return;
      } catch (err) {
        if (err instanceof StaleLine || gen !== this.generation) return; // a newer line took over
        this.aiFailures++;
        console.warn("[feud] AI voice unavailable, using browser speech", err);
      }
    }

    if (!opts.silent) await this.handOff();
    if (gen !== this.generation) return;
    this.stopPlayback();
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (opts.silent || !synth || !line.text) this.runClock(line, estimateSpeechMs(line.text, VOICE_SPEED), opts);
    else this.browserSpeak(synth, line, cfg, opts);
  }

  stop() {
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.stopPlayback();
  }

  /** One sentence's voice: from the recent-sentence cache, or fetched for this line. */
  private async clip(lineId: string, part: number, text: string, token: string, signal: AbortSignal): Promise<Clip> {
    const cached = this.clips.get(text);
    if (cached) {
      this.clips.delete(text);
      this.clips.set(text, cached);
      return cached;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort);
    const timeout = setTimeout(abort, CLIP_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/games/${this.code}/voice`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ lineId, part }),
        signal: controller.signal,
      });
      if (res.status === 409) throw new StaleLine("line has passed");
      if (!res.ok) throw new Error(`voice ${res.status}`);
      const rate = Number(res.headers.get("x-voice-rate"));
      const clip = { blob: await res.blob(), rate: rate > 0 ? rate : VOICE_SPEED };
      this.clips.set(text, clip);
      if (this.clips.size > MAX_CLIPS) this.clips.delete(this.clips.keys().next().value!);
      return clip;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  /** Play a line's sentences in turn, each as soon as it's ready; finish in the browser's voice if one fails. */
  private async playParts(line: Line, parts: string[], clips: Promise<Clip>[], cfg: Voice, hooks: Hooks) {
    const pb = ++this.playback;
    const shares = partShares(parts);
    this.playing = true;
    hooks.onProgress?.(line, 0);
    try {
      for (let i = 0; i < parts.length; i++) {
        const clip = await clips[i].catch(() => null);
        if (pb !== this.playback) return;
        this.restMs = estimateSpeechMs(parts.slice(i + 1).join(" "), VOICE_SPEED);
        const { start, share } = shares[i];
        if (!clip) {
          const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
          const rest = { start, share: 1 - start };
          if (synth) this.browserSpeak(synth, line, cfg, hooks, plainText(parts.slice(i).join(" ")), rest);
          else this.runClock(line, estimateSpeechMs(parts.slice(i).join(" "), VOICE_SPEED), hooks, rest);
          return;
        }
        await this.playClip(clip, parts[i], i === 0 ? hooks.onStart : undefined, (f) => hooks.onProgress?.(line, start + f * share));
        if (pb !== this.playback) return;
      }
      this.clearTicker();
      hooks.onProgress?.(line, 1);
      hooks.onEnd?.();
      hooks.onDone?.(line);
    } finally {
      if (pb === this.playback) this.playing = false;
    }
  }

  /** Play one sentence; resolves when it ends, fails, or playback is stopped. */
  private playClip(clip: Clip, text: string, onStart: (() => void) | undefined, onFraction: (f: number) => void): Promise<void> {
    if (this.url) URL.revokeObjectURL(this.url);
    const url = URL.createObjectURL(clip.blob);
    this.url = url;
    const audio = new Audio(url);
    audio.playbackRate = clip.rate;
    audio.preservesPitch = true;
    this.audio = audio;
    const estimate = estimateSpeechMs(text, VOICE_SPEED) / 1000;
    return new Promise<void>((resolve) => {
      const done = () => {
        this.settle = null;
        this.clearTicker();
        onFraction(1);
        resolve();
      };
      this.settle = resolve;
      audio.onplay = () => {
        onStart?.();
        this.tick(() => {
          const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : estimate * clip.rate;
          onFraction(audio.currentTime / length);
        });
      };
      audio.onended = audio.onerror = done;
      onFraction(0);
      audio.play().catch(() => {
        // Autoplay blocked: keep the captions (and the game) moving on an estimate.
        onStart?.();
        const startedAt = Date.now();
        this.tick(() => {
          const f = (Date.now() - startedAt) / (estimate * 1000);
          if (f >= 1) done();
          else onFraction(f);
        });
      });
    });
  }

  private browserSpeak(
    synth: SpeechSynthesis,
    line: Line,
    cfg: Voice,
    hooks: Hooks,
    said = plainText(line.text),
    span = { start: 0, share: 1 },
  ) {
    const utterance = new SpeechSynthesisUtterance(said);
    const voice = chooseVoice(cfg);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? cfg.lang;
    utterance.rate = cfg.rate * VOICE_SPEED;
    utterance.pitch = cfg.pitch;
    const progress = (f: number) => hooks.onProgress?.(line, span.start + Math.min(1, f) * span.share);
    // Word boundaries give exact progress where the browser reports them;
    // otherwise (e.g. some network voices) fall back to an estimated clock.
    let spokenTo = -1;
    const estimate = estimateSpeechMs(said, utterance.rate);
    // A cancelled utterance still fires its events, after the next line has begun.
    const gen = this.generation;
    const current = () => gen === this.generation;
    utterance.onboundary = (e) => {
      spokenTo = e.charIndex;
    };
    // Some browsers occasionally never start speaking; keep the captions moving anyway.
    const watchdog = setTimeout(() => current() && this.runClock(line, estimate, hooks, span), 2500);
    utterance.onstart = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      hooks.onStart?.();
      const startedAt = Date.now();
      this.speechEndsAt = startedAt + estimate;
      this.tick(() => progress(spokenTo >= 0 ? spokenTo / said.length : (Date.now() - startedAt) / estimate));
    };
    utterance.onend = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      this.clearTicker();
      hooks.onProgress?.(line, 1);
      hooks.onEnd?.();
      hooks.onDone?.(line);
    };
    utterance.onerror = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      hooks.onEnd?.();
      this.runClock(line, estimate, hooks, span);
    };
    progress(0);
    synth.cancel();
    synth.speak(utterance);
  }

  /** Captions without a voice: advance on an estimated speaking pace. */
  private runClock(line: Line, ms: number, hooks: Hooks, span = { start: 0, share: 1 }) {
    const startedAt = Date.now();
    hooks.onProgress?.(line, span.start);
    this.tick(() => {
      const fraction = (Date.now() - startedAt) / ms;
      hooks.onProgress?.(line, span.start + Math.min(1, fraction) * span.share);
      if (fraction >= 1) {
        this.clearTicker();
        hooks.onDone?.(line);
      }
    });
  }

  /**
   * Make room for the next line: let the current one finish if it's nearly
   * done, otherwise fade it out, so the host never stops mid-word.
   */
  private async handOff(): Promise<void> {
    const audio = this.audio;
    if (this.playing && audio && !audio.paused && !audio.ended) {
      const left =
        (Number.isFinite(audio.duration) ? ((audio.duration - audio.currentTime) / audio.playbackRate) * 1000 : Infinity) +
        this.restMs;
      if (left <= WAIT_MS) return until(() => !this.playing, left + 1000);
      // Fade the sentence that's playing, and don't start the line's next one.
      this.playback++;
      const from = audio.volume;
      const started = Date.now();
      return until(() => {
        audio.volume = from * Math.max(0, 1 - (Date.now() - started) / FADE_MS);
        return audio.volume === 0;
      }, FADE_MS + 100);
    }
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const left = this.speechEndsAt - Date.now();
    if (synth?.speaking && left <= WAIT_MS) await until(() => !synth.speaking, Math.max(0, left) + 1500);
  }

  private tick(fn: () => void) {
    this.clearTicker();
    this.ticker = setInterval(fn, 100);
  }

  private clearTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private stopPlayback() {
    this.playback++;
    this.playing = false;
    this.clearTicker();
    this.settle?.();
    this.settle = null;
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }
}

/** Resolve once `done()` is true (checked every 50ms), or after `ms` regardless. */
function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => (done() || Date.now() >= deadline ? resolve() : setTimeout(check, 50));
    check();
  });
}
