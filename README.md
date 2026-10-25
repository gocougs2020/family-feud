# Family Feud Live

A live, multiplayer, AI-hosted take on Family Feud, played the Jackbox way: the **show runs on a big screen** and everyone **plays from their phone**. Scan the QR code, pick a team, buzz in, type answers, and steal. Every screen stays in sync in real time.

Built on Next.js, the Vercel AI SDK and AI Gateway, and Supabase. It ships with a **Harry Potter fan pack** ("The Wizarding Feud"), a **Classic** pack, and an **Any Topic** mode where the AI writes a survey about whatever you type.

> Fan-made party game. Not affiliated with or endorsed by Family Feud / Fremantle, J.K. Rowling, Warner Bros. or Wizarding World. The packs contain no official art, music or logos. All visuals and music are generated in code.

## What's in the box

- **TV screen** (`/host/ABCD`): a broadcast-style stage with a React Three Fiber backdrop (floating candles, an enchanted starry ceiling and a castle silhouette for the wizard pack; sweeping studio lights and a marquee for the classic pack). On top of that sit a flipping 3D answer board, strike X's, a score podium, a "Survey says…" beat, slow camera drift, and a lower-third chyron for the host. Without WebGL it falls back to an animated CSS stage.
- **Phone controller** (`/play/ABCD`): join with a name, switch teams, a big BUZZ button for face-offs, an answer box when it's your turn, play/pass, team steals, and haptic buzzes on your turn.
- **AI host** (via the Vercel AI Gateway):
  - writes a fresh survey (questions, ranked answers, points and aliases) for every game, while players are still joining in the lobby
  - judges fuzzy answers like a real Feud judge ("Ronald" is "Ron Weasley", "the snake" is "Basilisk"), with an in-character quip
  - writes a sign-off recap at the end of the game
  - …and falls back to hand-written surveys and lines whenever AI is off or slow, so the game never stalls.
- **Host voice and music**: with AI on, the host's lines are voiced by **`fish-audio/drama-3`** through the AI Gateway, with per-pack delivery notes (a theatrical British professor, a punchy studio host). Without AI, the browser's speech synthesis takes over. The original, procedurally composed music (a candle-lit waltz for the wizard pack, a studio groove for classic) is re-written from a random seed each game. Sound effects (ding, buzzer, drum roll, applause) are synthesized too. There are no audio files.
- **Real rules**: face-off (top answer wins outright, otherwise the higher answer wins), play or pass, rotating turns so everyone answers, three strikes, team steal, and double/triple points in the late rounds.

## Quick start (no accounts needed)

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 and click **Create game**. With no environment variables set, games are kept in memory and the built-in questions are used. Everything works locally, including the real-time sync (over Server-Sent Events).

To play with real phones on your Wi-Fi, phones need your computer's network address rather than `localhost`:

```bash
pnpm dev -H 0.0.0.0
```

Then open the TV screen at `http://<your-computer's-LAN-IP>:3000`, so the QR code points somewhere phones can reach.

To turn on the AI host locally, add an AI Gateway key to `.env.local` (see [`.env.example`](.env.example)):

```bash
AI_GATEWAY_API_KEY=your_key
```

## Deploy to Vercel

1. **Import the repo** into Vercel.
2. **Add Supabase** from the Vercel Marketplace (Storage → Supabase). It creates a project on the free tier and adds the env vars (`NEXT_PUBLIC_SUPABASE_URL`, the anon/publishable key, the service-role/secret key) to your Vercel project.
3. **Create the tables.** Run [`supabase/migrations/20261024000000_init.sql`](supabase/migrations/20261024000000_init.sql) in the Supabase SQL editor, or run `supabase db push` with the Supabase CLI.
4. **Enable AI.** Turn on AI Gateway for the team. Deployed functions authenticate to it automatically with OIDC, so no API key is needed.
5. Optionally set `SESSION_SECRET` to a long random string. If it's unset, the Supabase secret key is used to sign seat tokens.
6. Deploy, open the site on a TV or laptop, and create a game.

The memory store only works within one Node process, so a deployment needs Supabase. The home page footer shows which sync mode and AI mode are active.

### Why Supabase rather than Neon?

Both have generous free Postgres tiers, but this app needs **real-time push** to every phone. Supabase includes Realtime on the free plan (up to 200 concurrent connections), so a single free service covers both the database and live sync. With Neon you would also need a realtime service such as Pusher or Ably, or have every phone poll. For a party game with a handful of rooms, Supabase's free tier is effectively $0.

One thing to know: free Supabase projects **pause after a week of inactivity**. Un-pause from the dashboard before game night, or upgrade if you host often.

AI cost is small. Each game uses one survey-writing call on `AI_MODEL`, plus one fast-model call for each answer that the local matcher can't decide and one for the recap. On top of that, each host line (a sentence or two) is one text-to-speech call to `AI_TTS_MODEL` (`fish-audio/drama-3` by default). Only the TV's host seat can request speech, and only for the line currently on screen.

## How it works

```
 Phones (/play/ABCD)          TV (/host/ABCD)
   │ POST /action               │ POST /action {tick} when a timer ends
   ▼                            ▼
 Route handlers ──► game-service ──► engine (pure rules) ──► store.mutate (compare-and-swap on version)
                       │                                         │
                       └─ AI Gateway: write survey / judge / recap │
                                                                   ▼
                                     Supabase `games` row ──Realtime──► every screen
                                     (memory + SSE in local dev)
```

- **One row per game.** `games.state` is the public state (players, board, scores, turn, host line). Every screen subscribes to that row with Supabase Realtime `postgres_changes`, and also re-fetches on focus and every few seconds, so a dropped socket never leaves a phone stuck.
- **Hidden answers never reach the browser.** The survey lives in `game_secrets`, which has RLS on and no policies, so only the server's secret key can read it. A tile's answer is copied into public state only when it's revealed.
- **Race-free buzzing.** Every write is `read → apply pure rule → update … where version = n`, retried on conflict, so two buzzes in the same millisecond resolve cleanly.
- **No server timers.** Each phase stores a `deadline`. The TV asks the server to `tick` when it passes, and phones do the same a little later as a backup. The server checks the deadline itself, so these calls are idempotent.
- **No accounts.** Joining returns an HMAC-signed seat token, kept in `localStorage` and sent as a Bearer header.

### Project layout

```
src/
  app/                    routes: / (home), /host/[code] (TV), /play/[code] (phone), /api/games/...
  components/host/        TV stage, board, 3D scene, CSS fallback backdrop
  components/play/        phone controller
  lib/engine.ts           all game rules as pure functions (unit-tested)
  lib/game-service.ts     orchestrates store + engine + AI
  lib/ai.ts               survey writer, answer judge, recap, host TTS (AI SDK + Gateway)
  lib/match.ts            fast local answer matching (aliases, plurals, typos)
  lib/store/              memory (dev) and Supabase stores
  lib/client/             realtime hook, API client, synthesized audio, speech
  packs/                  question packs: theme (client) + content (server)
supabase/migrations/      database schema
```

## Make your own pack

A pack is two files: a client-safe **theme** (name, colors, fonts, 3D scene, music mood, host voice, team presets) and a server-only **content** file (host persona, AI guidance, topic angles, fallback surveys, canned host lines). See [docs/creating-a-pack.md](docs/creating-a-pack.md).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm test` | Run engine and matcher unit tests (Vitest) |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build |

## Ideas and contributions welcome

- Fast Money bonus round
- Host-side answer override ("the judges will allow it")
- AI-generated scene art per pack
- More packs: send a PR!

## License

[MIT](LICENSE). Pack content is fan-made and provided for non-commercial fun.
