import type { Difficulty, GameSettings, SurveyAnswer } from "./types";

// Difficulty sets how hard the survey's questions are and how strictly
// guesses are judged, by both the local matcher and the AI judge.

export const DIFFICULTIES: Record<Difficulty, { label: string; blurb: string }> = {
  easy: { label: "Easy", blurb: "Friendly questions, generous judging" },
  medium: { label: "Medium", blurb: "Trickier questions; answers must be specific" },
  hard: { label: "Hard", blurb: "Tough questions, strict judging" },
};

export const DEFAULT_DIFFICULTY: Difficulty = "medium";

export function parseDifficulty(value: unknown): Difficulty {
  return value === "easy" || value === "medium" || value === "hard" ? value : DEFAULT_DIFFICULTY;
}

export const difficultyOf = (settings: GameSettings): Difficulty => settings.difficulty ?? DEFAULT_DIFFICULTY;

/** The phrasings a guess may match at this difficulty: loose ones only count on easy. */
export function acceptedNames(answer: SurveyAnswer, difficulty: Difficulty): string[] {
  return [answer.text, ...answer.aliases, ...(difficulty === "easy" ? (answer.loose ?? []) : [])];
}
