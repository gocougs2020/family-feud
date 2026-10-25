import type { SurveyRound, TeamPreset } from "@/lib/types";

/**
 * Client-safe description of a pack: everything the screens need to look and
 * sound right. Never put survey answers here — this ships to the browser.
 */
export interface PackTheme {
  id: string;
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  hostName: string;
  /** "We surveyed 100 ___" */
  audienceLabel: string;
  font: "cinzel" | "anton";
  scene: "great-hall" | "studio";
  music: "mystic-waltz" | "game-show";
  voice: {
    /** delivery notes for the AI voice (fish-audio/drama-3 via AI Gateway) */
    style: string;
    /** optional provider voice id; leave unset for the model's default */
    aiVoice?: string;
    /** browser speech-synthesis fallback settings */
    lang: string;
    rate: number;
    pitch: number;
    preferNames: string[];
  };
  colors: {
    bg: string;
    bgAlt: string;
    fog: string;
    panel: string;
    tile: string;
    tileEdge: string;
    tileFace: string;
    tileText: string;
    accent: string;
    accentSoft: string;
    text: string;
    strike: string;
  };
  /** team pairings; one is picked at random per game */
  teams: [TeamPreset, TeamPreset][];
  playerColors: string[];
  /** pack lets the host type any topic and has the AI write the survey */
  customTopic?: boolean;
}

export type HostLineKey =
  | "lobby"
  | "preparing"
  | "gameIntro"
  | "roundIntro"
  | "faceoff"
  | "buzz"
  | "topHit"
  | "hit"
  | "miss"
  | "dupe"
  | "timeout"
  | "control"
  | "strikeOut"
  | "stealHit"
  | "stealMiss"
  | "roundWon"
  | "sweep"
  | "gameOver"
  | "tie";

/**
 * Lines may use {name}, {team}, {other}, {answer}, {points}, {round}, {multiplier}.
 */
export type HostLines = Record<HostLineKey, string[]>;

/** Server-only pack content: hidden fallback surveys and AI instructions. */
export interface PackContent {
  id: string;
  /** who the host is and how they talk, for the AI */
  hostPersona: string;
  /** who was "surveyed" */
  audience: string;
  /** guidance for writing questions */
  aiGuidance: string;
  /** sub-topics sampled per game so every AI survey feels different */
  angles: string[];
  fallbackRounds: SurveyRound[];
  lines: HostLines;
}
