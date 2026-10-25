# Family Feud Live

A live, multiplayer, AI-hosted take on Family Feud, played the Jackbox way: the **show runs on a big screen** and everyone **plays from their phone**. Scan the QR code, pick a team, buzz in, type answers, and steal. Every screen stays in sync in real time.

Built on Next.js, the Vercel AI SDK and AI Gateway, and Supabase. It ships with a **Harry Potter fan pack** ("The Wizarding Feud"), a **Classic** pack, and an **Any Topic** mode where the AI writes a survey about whatever you type.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgocougs2020%2Ffamily-feud&project-name=family-feud&repository-name=family-feud&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%2C%22protocol%22%3A%22storage%22%7D%5D)

**Live demo:** https://family-feud-self.vercel.app

> Fan-made party game. Not affiliated with or endorsed by Family Feud / Fremantle, J.K. Rowling, Warner Bros. or Wizarding World. The packs contain no official art, music or logos. All visuals and music are generated in code.

## What's in the box

- **TV screen** (`/host/ABCD`): a broadcast-style stage with a React Three Fiber backdrop (floating candles, an enchanted starry ceiling and a castle silhouette for the wizard pack; sweeping studio lights and a marquee for the classic pack). On top of that sit a flipping 3D answer board, strike X's, a score podium, a "Survey says…" beat, slow camera drift, and a lower-third chyron for the host. Without WebGL it falls back to an animated CSS stage.
- **Phone controller** (`/play/ABCD`): join with a name, switch teams, a big BUZZ button for face-offs, an answer box when it's your turn, play/pass, team steals, and haptic buzzes on your turn.
- **AI host** (via the Vercel AI Gateway):
  - writes a fresh survey (questions, ranked answers, points and aliases) for every game, while players are still joining in the lobby
  - judges fuzzy answers like a real Feud judge ("Ronald" is "Ron Weasley", "the snake" is "Basilisk"), with an in-character quip
  - writes a sign-off recap at the end of the game
  - …and falls back to hand-written surveys and lines whenever AI is off or slow, so the game never stalls.
- **Host voice and music**: with AI on, the host's lines are voiced by **`fish-audio/drama-3`** through the AI Gateway, with per-pack delivery notes (Gilderoy Lockhart hosts the wizard pack; a punchy studio host does Classic). Pick a specific Fish Audio voice per pack with `AI_TTS_VOICE_<PACK_ID>`, e.g. `AI_TTS_VOICE_HARRY_POTTER`. Without AI, the browser's speech synthesis takes over. The original, procedurally composed music (a candle-lit waltz for the wizard pack, a studio groove for classic) is re-written from a random seed each game. Sound effects (ding, buzzer, drum roll, applause) are synthesized too. There are no audio files.
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

## Deploy your own (free)

Click **Deploy with Vercel** above. In about two minutes you'll have your own copy, with nothing to configure by hand:

1. Vercel copies the repo to your GitHub account and creates the project.
2. It asks you to **add Supabase**. Choose the **Free** plan. This creates the database and sets all the environment variables (Supabase URL, keys and Postgres connection strings).
3. The build runs `scripts/migrate.mjs`, which creates the tables automatically. There's no SQL to paste.
4. The AI host works out of the box: Vercel deployments authenticate to the AI Gateway on their own (OIDC), so there's no API key. Usage comes out of your team's AI Gateway credits.

Then open the site on a TV or laptop and create a game. The home page footer shows whether sync is "Supabase Realtime" and whether the AI host is on.

<details>
<summary>Already have a Supabase project, or deploying by hand?</summary>

Set these on your Vercel project (Production and Preview), then redeploy:

| Variable | Where to find it (Supabase dashboard) |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable (or legacy `anon`) key |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → secret (or legacy `service_role`) key. Copy it from the dashboard: the Supabase CLI shows new-style secret keys masked. |
| `POSTGRES_URL_NON_POOLING` | Connect → Session pooler connection string (used only to run migrations at build time) |
| `SESSION_SECRET` *(optional)* | Any long random string. It defaults to the Supabase secret key. |

Without `POSTGRES_URL_NON_POOLING`, run [`supabase/migrations/20261024000000_init.sql`](supabase/migrations/20261024000000_init.sql) once in the SQL editor instead. You can also run migrations from your machine with `pnpm db:migrate`.
</details>

Without a database, a deployment falls back to in-memory games. That only works inside one server process, so the home page shows a warning until Supabase is connected.

### Why Supabase?

The game needs a database **and** real-time push to every phone. Supabase's free plan includes both: Postgres plus Realtime with up to 200 concurrent connections. It's also on the Vercel Marketplace, so the Deploy button can provision it. Free Postgres options like Neon or Turso would need a second service for real-time (Pusher, Ably, Liveblocks), or every phone polling the server. For a party game that hosts a few rooms, Supabase's free tier costs $0.

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
| `pnpm build` | Apply database migrations (if a database URL is set), then a production build |
| `pnpm db:migrate` | Apply `supabase/migrations/*.sql` to the database in `POSTGRES_URL_NON_POOLING` / `DATABASE_URL` |

## Ideas and contributions welcome

- Fast Money bonus round
- Host-side answer override ("the judges will allow it")
- AI-generated scene art per pack
- More packs: send a PR!

## License

[MIT](LICENSE). Pack content is fan-made and provided for non-commercial fun.
