"use client";

import { estimateSpeechMs } from "@/lib/captions";
import type { PackTheme } from "@/packs/types";

// The host's voice. When AI is on, the TV fetches each line from the AI
// Gateway (fish-audio/drama-3) via /api/games/[code]/voice; otherwise, or if
// that's slow or fails, it uses the browser's built-in speech synthesis.
// Either way it reports how far through the line it is, so the TV can show
// captions in step with the voice.

type Voice = PackTheme["voice"];
type Line = { id: string; text: string };
interface Hooks {
  onStart?: () => void;
  onEnd?: () => void;
  /** how much of `line` has been spoken, 0–1 */
  onProgress?: (line: Line, fraction: number) => void;
}

/** Played a touch faster than the model's natural pace, to keep the show moving. */
const SPEED = 1.12;
/** A line this close to finishing gets to finish before the next one starts. */
const TAIL_MS = 1600;

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
  /** bumped by every new line, so stale async work can tell it lost */
  private generation = 0;
  /** set false after the AI voice fails, so we stop retrying every line */
  private aiWorks = true;

  constructor(private code: string) {}

  /** Speak a line, or with `silent`, just run its captions on an estimated clock. */
  async say(line: Line, cfg: Voice, opts: { ai: boolean; token: string | null; silent?: boolean } & Hooks) {
    const gen = ++this.generation;
    this.request?.abort();
    this.request = null;

    if (!opts.silent && opts.ai && opts.token && this.aiWorks) {
      const controller = new AbortController();
      this.request = controller;
      const timeout = setTimeout(() => controller.abort(), 9_000);
      try {
        const res = await fetch(`/api/games/${this.code}/voice`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
          body: JSON.stringify({ lineId: line.id }),
          signal: controller.signal,
        });
        if (res.status === 409 || gen !== this.generation) return; // a newer line took over
        if (!res.ok) throw new Error(`voice ${res.status}`);
        const blob = await res.blob();
        await this.finishTail();
        if (gen !== this.generation) return;
        this.stopPlayback();
        this.playClip(line, URL.createObjectURL(blob), opts);
        return;
      } catch (err) {
        if (gen !== this.generation) return;
        if (!(err instanceof DOMException && err.name === "AbortError")) this.aiWorks = false;
        console.warn("[feud] AI voice unavailable, using browser speech", err);
      } finally {
        clearTimeout(timeout);
      }
    }

    this.stopPlayback();
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (opts.silent || !synth || !line.text) this.runClock(line, estimateSpeechMs(line.text, SPEED), opts);
    else this.browserSpeak(synth, line, cfg, opts);
  }

  stop() {
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.stopPlayback();
  }

  private playClip(line: Line, url: string, hooks: Hooks) {
    this.url = url;
    const audio = new Audio(url);
    audio.playbackRate = SPEED;
    audio.preservesPitch = true;
    this.audio = audio;
    const estimate = estimateSpeechMs(line.text, SPEED) / 1000;
    audio.onplay = () => {
      hooks.onStart?.();
      this.tick(() => {
        const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : estimate * SPEED;
        hooks.onProgress?.(line, audio.currentTime / length);
      });
    };
    audio.onended = audio.onerror = () => {
      this.clearTicker();
      hooks.onProgress?.(line, 1);
      hooks.onEnd?.();
    };
    hooks.onProgress?.(line, 0);
    audio.play().catch(() => this.runClock(line, estimate * 1000, hooks));
  }

  private browserSpeak(synth: SpeechSynthesis, line: Line, cfg: Voice, hooks: Hooks) {
    const utterance = new SpeechSynthesisUtterance(line.text);
    const voice = chooseVoice(cfg);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? cfg.lang;
    utterance.rate = cfg.rate * SPEED;
    utterance.pitch = cfg.pitch;
    // Word boundaries give exact progress where the browser reports them;
    // otherwise (e.g. some network voices) fall back to an estimated clock.
    let spokenTo = -1;
    const estimate = estimateSpeechMs(line.text, utterance.rate);
    // A cancelled utterance still fires its events, after the next line has begun.
    const gen = this.generation;
    const current = () => gen === this.generation;
    utterance.onboundary = (e) => {
      spokenTo = e.charIndex;
    };
    // Some browsers occasionally never start speaking; keep the captions moving anyway.
    const watchdog = setTimeout(() => current() && this.runClock(line, estimate, hooks), 2500);
    utterance.onstart = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      hooks.onStart?.();
      const startedAt = Date.now();
      this.tick(() =>
        hooks.onProgress?.(line, spokenTo >= 0 ? spokenTo / line.text.length : (Date.now() - startedAt) / estimate),
      );
    };
    utterance.onend = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      this.clearTicker();
      hooks.onProgress?.(line, 1);
      hooks.onEnd?.();
    };
    utterance.onerror = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      hooks.onEnd?.();
      this.runClock(line, estimate, hooks);
    };
    hooks.onProgress?.(line, 0);
    synth.cancel();
    synth.speak(utterance);
  }

  /** Captions without a voice: advance on an estimated speaking pace. */
  private runClock(line: Line, ms: number, hooks: Hooks) {
    const startedAt = Date.now();
    hooks.onProgress?.(line, 0);
    this.tick(() => {
      const fraction = (Date.now() - startedAt) / ms;
      hooks.onProgress?.(line, fraction);
      if (fraction >= 1) this.clearTicker();
    });
  }

  /** If the current clip is nearly done, let it finish rather than cut it off. */
  private finishTail(): Promise<void> {
    const audio = this.audio;
    if (!audio || audio.paused || audio.ended || !Number.isFinite(audio.duration)) return Promise.resolve();
    const left = ((audio.duration - audio.currentTime) / audio.playbackRate) * 1000;
    if (left > TAIL_MS) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        audio.removeEventListener("ended", done);
        resolve();
      };
      const timer = setTimeout(done, left + 250);
      audio.addEventListener("ended", done);
    });
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
    this.clearTicker();
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
