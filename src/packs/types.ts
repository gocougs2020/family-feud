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
    /** delivery notes, for speech models that take instructions */
    style: string;
    /**
     * a short delivery cue, for speech models that read cues inline instead
     * (Fish Audio): put in square brackets before each sentence
     */
    cue: string;
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
  | "join"
  | "preparing"
  | "gameIntro"
  | "rules"
  | "roundIntro"
  | "faceoff"
  | "noBuzz"
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
 * Canned host lines, used when AI is off or slow. With AI on, the host writes
 * every line fresh, except `rules`, which is always read as written so the
 * rules come out right. Lines may use {name}, {names}, {team}, {other}, {answer},
 * {points}, {round}, {multiplier}.
 */
export type HostLines = Record<HostLineKey, string[]>;

/** Server-only pack content: hidden fallback surveys and AI instructions. */
export interface PackContent {
  id: string;
  /** who the host is and how they talk, for the AI */
  hostPersona: string;
  /** comic angles, one sampled per AI host line so the jokes don't settle into a rut */
  hostRiffs?: string[];
  /** who was "surveyed" */
  audience: string;
  /** guidance for writing questions */
  aiGuidance: string;
  /** sub-topics sampled per game so every AI survey feels different */
  angles: string[];
  fallbackRounds: SurveyRound[];
  lines: HostLines;
}
