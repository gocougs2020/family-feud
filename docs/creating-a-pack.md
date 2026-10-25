# Creating a pack

A pack is a themed version of the game, like "The Wizarding Feud". It has two halves:

| File | Runs on | Contains |
| --- | --- | --- |
| `src/packs/<id>/theme.ts` | browser + server | name, colors, font, 3D scene, music mood, host name and voice, team presets |
| `src/packs/<id>/content.ts` | server only | host persona, AI guidance, topic angles, fallback surveys, canned host lines |

Keep survey answers out of `theme.ts`, because everything in it ships to players' browsers.

## 1. Theme

```ts
// src/packs/space/theme.ts
import type { PackTheme } from "../types";

export const spaceTheme: PackTheme = {
  id: "space",
  name: "Feud in Space",
  tagline: "A sci-fi pack",
  description: "We surveyed 100 astronauts.",
  emoji: "🚀",
  hostName: "Captain Nova",
  audienceLabel: "100 astronauts",
  font: "anton",            // "cinzel" (storybook serif) or "anton" (game-show block)
  scene: "studio",          // "great-hall" (candles + castle) or "studio" (stage lights)
  music: "game-show",       // "mystic-waltz" or "game-show"
  voice: {
    style: "A cheesy retro sci-fi hero narrating a captain's log.", // for speech models that take instructions
    cue: "heroic, over-the-top captain", // Fish Audio reads this inline, as [cue] before each sentence
    lang: "en-US",
    rate: 1,
    pitch: 1,
    preferNames: ["Samantha"],
  },
  colors: { /* bg, tile, accent, strike... see PackTheme */ },
  teams: [[{ name: "Rockets", color: "#ff5a36" }, { name: "Comets", color: "#22b8ff" }]],
  playerColors: ["#f2c230", "#ff5a36", "#22b8ff", "#7bd389"],
};
```

## 2. Content

```ts
// src/packs/space/content.ts
import type { PackContent } from "../types";

export const spaceContent: PackContent = {
  id: "space",
  hostPersona: "Captain Nova, a cheesy retro sci-fi hero who narrates everything like a captain's log.",
  // optional: comic angles, one sampled per AI host line so the jokes stay varied
  hostRiffs: ["a captain's log entry", "blame it on the aliens", "a terrible space pun"],
  audience: "100 astronauts",
  aiGuidance: "Write Family Feud survey questions about space, astronauts and sci-fi. Keep them guessable.",
  angles: ["life on the space station", "aliens", "planets", "rocket launches", "space food"],
  fallbackRounds: [
    {
      question: "Name something an astronaut would miss from Earth.",
      answers: [
        { text: "Family", points: 34, aliases: ["kids", "loved ones"] },
        { text: "Fresh Food", points: 22, aliases: ["pizza", "real food"] },
        // 4-8 answers, most popular first, points ≤ 100 in total
      ],
    },
  ],
  lines: {
    // canned lines used whenever the AI is off or slow. With AI on, the host
    // writes every line fresh from your persona; these are the fallback.
    // Placeholders: {name} {names} {team} {other} {answer} {points} {round}
    lobby: ["Welcome aboard! Grab your phones."],
    // `rules` is read word for word before round 1, AI or not, so keep it accurate
    rules: ["Here's how it works: type your answer when the question pops up, then buzz in..."],
    // ...every HostLineKey needs at least one line
  },
};
```

Write at least as many fallback rounds as the longest game (5) so the pack works without AI. More is better, because each game picks a random subset.

## 3. Register it

Add the theme to `packThemes` in `src/packs/index.ts`, and the content to `contents` in `src/packs/server.ts`. The new pack then appears on the home page.

## New scenes or music

The 3D scenes live in `src/components/host/scene-3d.tsx` and the CSS fallback in `backdrop.tsx`. Add a value to `PackTheme["scene"]`, then render your scene in `Scene3D`. Music moods are data in `src/lib/client/audio.ts` (`MOODS`): tempo, scale, chord progressions and lead instrument. Adding one is usually a few lines.

## Content guidelines

- Fan packs are welcome. Use your own words: no copied text, official logos, artwork or music.
- Keep it family friendly. The AI is told to, but review the fallback surveys yourself.
