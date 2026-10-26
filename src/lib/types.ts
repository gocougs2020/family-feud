// Shared game types. `GameState` is public: it is stored in the `games` table,
// streamed to every screen in real time, and must never contain unrevealed
// survey answers. Hidden answers live in `GameSecret` (the `game_secrets` table).

export type TeamIndex = 0 | 1;

export type Phase =
  | "lobby"
  | "preparing" // waiting on AI to finish writing the survey
  | "round_intro"
  | "faceoff"
  | "play_or_pass"
  | "play"
  | "steal"
  | "round_end"
  | "game_over"
  | "closed"; // the room has been shut down; screens disconnect

export interface PublicPlayer {
  id: string;
  name: string;
  team: TeamIndex;
  color: string;
  joinedAt: number;
}

export interface TeamPreset {
  name: string;
  color: string;
}

export interface TeamState extends TeamPreset {
  score: number;
}

export interface BoardSlot {
  revealed: boolean;
  /** true when shown at round end rather than guessed */
  auto?: boolean;
  text?: string;
  points?: number;
}

export type GuessResult = "hit" | "miss" | "dupe" | "timeout";

export interface Guess {
  id: string;
  playerId: string | null;
  team: TeamIndex;
  text: string;
  result: GuessResult;
  answerIndex?: number;
  at: number;
}

export type TurnKind = "buzz" | "faceoff_answer" | "play_pass" | "answer" | "steal";

export interface Turn {
  id: string;
  kind: TurnKind;
  /** players allowed to act on this turn */
  playerIds: string[];
  team: TeamIndex | null;
  deadline: number;
  /** how long players get once the turn opens */
  ms: number;
  /**
   * While set, the turn is held: players can't act until the host finishes the
   * line `heldFor`. The TV opens it as soon as that line has been spoken; this
   * is the fallback time if it doesn't.
   */
  opensAt?: number;
  heldFor?: string;
  /**
   * Set while a submitted guess is being judged. `lineId` is the host reading
   * it out ("Harry says robes. Survey says…"); `saidAt` is when the TV
   * finished saying it, so the reveal can follow it.
   */
  judging?: { playerId: string; text: string; lineId?: string; saidAt?: number };
}

export interface FaceoffState {
  playerIds: [string | null, string | null]; // indexed by team
  /** players in the order they answered */
  answered: { playerId: string; team: TeamIndex; answerIndex: number | null }[];
}

export interface RoundState {
  index: number;
  /** null until the face-off opens, so nobody gets a head start on it */
  question: string | null;
  multiplier: number;
  board: BoardSlot[];
  bank: number;
  strikes: number;
  control: TeamIndex | null;
  faceoff: FaceoffState;
  guesses: Guess[];
  winner: TeamIndex | null;
  awarded: number;
}

export type GameEventKind =
  | "join"
  | "start"
  | "round_start"
  | "question"
  | "buzz"
  | "judging"
  | "hit"
  | "miss"
  | "dupe"
  | "timeout"
  | "control"
  | "steal_start"
  | "steal_hit"
  | "steal_miss"
  | "round_won"
  | "reveal_all"
  | "game_over";

export interface GameEvent {
  id: string;
  kind: GameEventKind;
  at: number;
  playerId?: string;
  team?: TeamIndex;
  answerIndex?: number;
  text?: string;
  strikes?: number;
}

/**
 * What prompted a host line, so the AI can write it fresh (falling back to the
 * pack's canned line). `tail` is spoken verbatim after it, e.g. the question.
 */
export interface HostCue {
  key: string;
  vars: Record<string, string | number>;
  tail?: string;
}

export interface HostLine {
  id: string;
  text: string;
  /** being written by the AI; screens wait for the final text */
  pending?: boolean;
  cue?: HostCue;
}

export type Difficulty = "easy" | "medium" | "hard";

export interface GameSettings {
  rounds: number;
  answerSeconds: number;
  /** how hard the questions are and how strictly answers are judged; rooms from before it existed play medium */
  difficulty?: Difficulty;
}

export interface GameState {
  v: 1;
  code: string;
  packId: string;
  /** free-text topic for the AI "custom" pack */
  topic?: string;
  phase: Phase;
  createdAt: number;
  settings: GameSettings;
  players: PublicPlayer[];
  vipId: string | null;
  teams: [TeamState, TeamState];
  /** status of the hidden survey for this game */
  prep: "pending" | "ready";
  surveySource?: "ai" | "built-in";
  roundIndex: number;
  round: RoundState | null;
  turn: Turn | null;
  /** phase-level timer (intros, round end) when no turn is active */
  deadline: number | null;
  /** rotation pointer per team, so every player gets a go */
  rotation: [number, number];
  event: GameEvent | null;
  hostLine: HostLine | null;
  /** the host's last few lines, so the AI doesn't repeat itself */
  hostLog?: string[];
  recap?: string;
  winner?: TeamIndex | "tie";
  /** the TV window was closed: the room shuts at this time unless it comes back (e.g. a reload) */
  closesAt?: number;
  /** why the room was shut down, once phase is "closed" */
  closed?: "host" | "host_left" | "expired";
}

export interface SurveyAnswer {
  text: string;
  points: number;
  /** other names for exactly this answer (spellings, full or short names): accepted at every difficulty */
  aliases: string[];
  /** looser ways to get at it (descriptions, categories, "candy shop" for Honeydukes): accepted only on easy */
  loose?: string[];
}

export interface SurveyRound {
  question: string;
  answers: SurveyAnswer[];
  /** optional host intro line written for this question */
  intro?: string;
}

export interface GameSecret {
  rounds: SurveyRound[];
  source: "ai" | "built-in";
  gameIntro?: string;
}

/**
 * The host's reactions to one round's answers, written ahead (as secret as the
 * survey, since they name the answers) so a found answer gets a line that's
 * thought through and already voiced. Indexed like the round's answers.
 */
export interface LineBank {
  /** the question these were written for, so a new game's survey never gets an old bank */
  question: string;
  hits: {
    /** the first answer of the face-off */
    faceoff?: string;
    /** a team playing the board */
    play?: string;
  }[];
}

export interface StoredGame {
  id: string;
  code: string;
  version: number;
  state: GameState;
}
