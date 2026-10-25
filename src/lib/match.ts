import type { SurveyAnswer } from "./types";

// Fast, local answer matching. Catches exact answers, aliases, plurals,
// partial names ("Hermione" → "Hermione Granger") and small typos. Anything it
// can't decide confidently goes to the AI judge.

const STOP = new Set(["the", "a", "an", "of", "to", "my", "his", "her", "their", "your", "some", "and", "&"]);

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(singular)
    .join(" ");
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ches|shes|xes|ses)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Score how well a guess matches one candidate string (0 = no match, 1 = exact). */
function scoreCandidate(guess: string, candidate: string): number {
  if (!guess || !candidate) return 0;
  if (guess === candidate) return 1;

  const g = guess.split(" ");
  const c = candidate.split(" ");

  // "hermione" vs "hermione granger": every guess word appears in the answer.
  if (g.every((w) => w.length >= 3 && c.includes(w))) return 0.85;
  // "a big snake" vs "snake": the whole answer appears in a short guess.
  if (c.every((w) => g.includes(w)) && g.length <= c.length + 2) return 0.8;

  // One typo per 6 letters: "basilsk" → "basilisk", but not "snakes" → "snape".
  const allowed = Math.floor(Math.max(guess.length, candidate.length) / 6);
  if (allowed > 0 && levenshtein(guess, candidate) <= allowed) return 0.75;
  return 0;
}

/**
 * Returns the index of the best matching answer, or null if nothing matched
 * confidently.
 */
export function localMatch(guess: string, answers: SurveyAnswer[]): number | null {
  const g = normalize(guess);
  if (!g) return null;
  let best: { index: number; score: number } | null = null;
  answers.forEach((answer, index) => {
    for (const candidate of [answer.text, ...answer.aliases]) {
      const score = scoreCandidate(g, normalize(candidate));
      if (score > 0 && (!best || score > best.score)) best = { index, score };
    }
  });
  return best ? (best as { index: number }).index : null;
}
