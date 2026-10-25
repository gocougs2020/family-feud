"use client";

import type { PackTheme } from "@/packs/types";

// The host's voice. When AI is on, the TV fetches each line from the AI
// Gateway (fish-audio/drama-3) via /api/games/[code]/voice; otherwise, or if
// that's slow or fails, it uses the browser's built-in speech synthesis.

type Voice = PackTheme["voice"];
interface Hooks {
  onStart?: () => void;
  onEnd?: () => void;
}

function chooseVoice(cfg: Voice): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  for (const name of cfg.preferNames) {
    const match = voices.find((v) => v.name.includes(name) && v.lang.startsWith(cfg.lang.slice(0, 2)));
    if (match) return match;
  }
  return voices.find((v) => v.lang === cfg.lang) ?? voices.find((v) => v.lang.startsWith(cfg.lang.slice(0, 2))) ?? null;
}

function browserSpeak(text: string, cfg: Voice, hooks: Hooks) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = chooseVoice(cfg);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? cfg.lang;
  utterance.rate = cfg.rate;
  utterance.pitch = cfg.pitch;
  utterance.onstart = () => hooks.onStart?.();
  utterance.onend = () => hooks.onEnd?.();
  utterance.onerror = () => hooks.onEnd?.();
  synth.speak(utterance);
}

export class HostVoice {
  private audio: HTMLAudioElement | null = null;
  private request: AbortController | null = null;
  private url: string | null = null;
  /** set false after the AI voice fails, so we stop retrying every line */
  private aiWorks = true;

  constructor(private code: string) {}

  async say(line: { id: string; text: string }, cfg: Voice, opts: { ai: boolean; token: string | null } & Hooks) {
    this.stop();
    if (opts.ai && opts.token && this.aiWorks) {
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
        if (res.status === 409 || controller.signal.aborted) return; // a newer line took over
        if (!res.ok) throw new Error(`voice ${res.status}`);
        this.url = URL.createObjectURL(await res.blob());
        if (this.request !== controller) return;
        const audio = new Audio(this.url);
        this.audio = audio;
        audio.onplay = () => opts.onStart?.();
        audio.onended = audio.onerror = () => opts.onEnd?.();
        await audio.play();
        return;
      } catch (err) {
        if (controller.signal.aborted && this.request !== controller) return;
        if (!(err instanceof DOMException && err.name === "AbortError")) this.aiWorks = false;
        console.warn("[feud] AI voice unavailable, using browser speech", err);
      } finally {
        clearTimeout(timeout);
      }
    }
    browserSpeak(line.text, cfg, opts);
  }

  stop() {
    this.request?.abort();
    this.request = null;
    if (this.audio) {
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
