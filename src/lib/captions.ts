// Closed captions for the host: a line is shown a sentence (or, for long
// sentences, a clause) at a time, in step with the voice. Pure functions, so
// the TV and the tests share them.

/** Captions longer than this are broken at a comma, dash or word boundary. */
const MAX_CHARS = 90;
/** Shorter bits ("Oh!", "Ha!") are folded into the next caption. */
const MIN_CHARS = 14;
/** A sentence break costs about this many characters' worth of speaking time. */
const PAUSE_CHARS = 6;
/** Rough speaking speed at rate 1, used when nothing better is known. */
const CHARS_PER_SEC = 15;

const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Jr|Sr|vs|etc|No)\.$/i;

function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const boundary = /[.!?…]+["'”’)]*\s+/g;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    const piece = text.slice(start, end).trim();
    if (ABBREVIATIONS.test(text.slice(start, m.index + m[0].trimEnd().length))) continue;
    if (piece) out.push(piece);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Break an over-long sentence near its middle, preferring punctuation. */
function breakLong(sentence: string): string[] {
  if (sentence.length <= MAX_CHARS) return [sentence];
  const mid = sentence.length / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = MIN_CHARS; i < sentence.length - MIN_CHARS; i++) {
    if (sentence[i] !== " ") continue;
    const prev = sentence[i - 1];
    const punct = prev === "," || prev === ";" || prev === ":" || prev === "—" || sentence[i + 1] === "—";
    // A clause break is worth being a little off-centre.
    const score = Math.abs(i - mid) - (punct ? sentence.length / 4 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return [sentence];
  return [...breakLong(sentence.slice(0, best).trim()), ...breakLong(sentence.slice(best + 1).trim())];
}

/** Inline delivery cues for the voice, e.g. "[scoffs]": never shown, and never read out as words. */
const CUE = /\[[^\]]*\]/g;

/** A host line as it's shown, or said by a voice that doesn't read cues. */
export function plainText(text: string): string {
  return text.replace(CUE, " ").replace(/\s+/g, " ").trim();
}

/** Give every sentence a delivery cue, unless the host already wrote one for it. */
export function withCue(text: string, cue: string): string {
  return sentences(text.replace(/\s+/g, " ").trim())
    .map((s) => (s.startsWith("[") ? s : `[${cue}] ${s}`))
    .join(" ");
}

export function splitCaptions(text: string): string[] {
  const pieces = sentences(plainText(text)).flatMap(breakLong);
  const out: string[] = [];
  let carry = "";
  for (let piece of pieces) {
    // Fold a short bit forward, as long as the result still fits on screen.
    if (carry) {
      if (carry.length + 1 + piece.length <= MAX_CHARS) piece = `${carry} ${piece}`;
      else out.push(carry);
      carry = "";
    }
    if (piece.length < MIN_CHARS) carry = piece;
    else out.push(piece);
  }
  if (carry) {
    if (out.length && `${out[out.length - 1]} ${carry}`.length <= MAX_CHARS) out[out.length - 1] += ` ${carry}`;
    else out.push(carry);
  }
  return out;
}

const weight = (caption: string) => caption.length + PAUSE_CHARS;

/** Which caption is being spoken when `fraction` (0–1) of the line has played. */
export function captionAt(captions: string[], fraction: number): number {
  if (captions.length < 2) return 0;
  const total = captions.reduce((sum, c) => sum + weight(c), 0);
  let at = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < captions.length; i++) {
    at -= weight(captions[i]);
    if (at < 0) return i;
  }
  return captions.length - 1;
}

/** Roughly how long a line takes to say, for timing captions without audio. */
export function estimateSpeechMs(text: string, rate = 1): number {
  const total = splitCaptions(text).reduce((sum, c) => sum + weight(c), 0);
  return (total / (CHARS_PER_SEC * rate)) * 1000;
}
