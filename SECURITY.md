# Security

Family Feud Live is built to be safe to fork and deploy publicly. This page covers what the repo does to protect your keys and your players, and what to set up on your side.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use GitHub's **[Report a vulnerability](https://github.com/gocougs2020/family-feud/security/advisories/new)** (private advisory) instead, and include steps to reproduce. I'll reply as soon as I can.

## No secrets in the repo

- The repo has **no API keys, tokens or connection strings**, in the code or in its git history. `.env*` files are git-ignored, except `.env.example`, which only lists the names of the variables.
- The AI host runs on a single AI Gateway API key, `AI_GATEWAY_API_KEY`, kept in your Vercel project settings (mark it **Sensitive**) or your git-ignored `.env.local`. AI is on only when the key is set: a deployment without it never falls back to Vercel's automatic OIDC token, so no AI usage can happen outside the key's budget.
- Supabase credentials are written to your Vercel project by the Supabase integration. They never pass through the repo.

## What reaches the browser, and what doesn't

| Value | Where it lives | Reaches the browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | server and client | **Yes, by design.** The publishable key can only read public game state (Row Level Security) and subscribe to Realtime. |
| `SUPABASE_SECRET_KEY` | server only | No. Only server modules (marked `server-only`) read it. |
| `AI_GATEWAY_API_KEY` | server only | No. Every model call happens in a route handler. |
| `SESSION_SECRET` | server only | No. It signs seat tokens. |
| `POSTGRES_URL_NON_POOLING` | build only | No. It's used to run migrations during the build. |

Only variables prefixed with `NEXT_PUBLIC_` are bundled into client code, so never give a secret that prefix.

## How the game protects itself

- **Hidden answers stay hidden.** Survey answers live in `game_secrets` and the host's pre-written reactions in `game_line_banks`. Both tables have Row Level Security on and no policies, so the publishable key can't read them. An answer is copied into public state only when it's revealed on the board.
- **Signed seats, no accounts.** The TV and each phone get an HMAC-SHA256 signed seat token (`src/lib/auth.ts`), compared in constant time. A token is tied to one game and one role (host or player), so a phone can't act as the TV or as another player. With no secret configured (local play), tokens are signed with a random key made per server process, never a hard-coded one.
- **Server-side rules.** Every move goes through the pure rules engine on the server (`src/lib/engine.ts`), which checks the seat, the phase and the deadline. The browser can't award points.
- **Bounded input.** Names (16 characters), custom topics (60 characters), players per room (16) and rounds (2-6) are all capped on the server.
- **The voice route can't be used as a free TTS service.** It speaks only the host line currently on screen, only for that game's TV.
- **Rooms expire.** Every room closes within an hour, and old rows are deleted automatically.
- **Security headers.** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and a strict referrer policy on every response, and no `X-Powered-By` header.
- **Generic errors.** Unexpected server errors are logged on the server and returned to the browser as "Something went wrong", with no stack traces.

## Protect your AI budget (if you turn AI on)

Creating a game is public by design (it's a party game, there are no accounts), and with AI on each new game makes a few model calls. If your deployment's URL is public, set these up:

1. **Start with AI off.** A fresh deployment has no API key, which means no model is ever called. It can't cost you anything in AI usage.
2. **Give the key a budget.** Every AI call goes through `AI_GATEWAY_API_KEY`, so its spend limit caps the whole game. Set it when you create the key (`vercel ai-gateway api-keys create --name family-feud --limit 10 --refresh-period monthly`) or later (`vercel ai-gateway budgets set api-key family-feud --limit 10`). At the limit, calls are refused and the game falls back to built-in questions and the browser's voice, so it keeps working.
3. **Prepaid credits are a second ceiling.** The AI Gateway spends credits you've bought. Leave auto top-up off if you want a firm cap. `AI_DISABLED=1` switches the AI off without touching the key.
4. **Rate-limit game creation.** Add a Vercel Firewall rule so one visitor can't create hundreds of games:

   ```bash
   vercel firewall rules add "Limit game creation" \
     --condition '{"type":"path","op":"eq","value":"/api/games"}' \
     --condition '{"type":"method","op":"eq","value":"POST"}' \
     --action rate_limit --rate-limit-window 600 --rate-limit-requests 10 \
     --rate-limit-keys ip --rate-limit-action deny --yes
   ```

   Or create the same rule in the dashboard, on your project's **Firewall** tab.

## If a key leaks

- **Supabase secret key:** rotate it in Supabase (Project Settings → API Keys), update it in Vercel, and redeploy. If `SESSION_SECRET` isn't set, rotating the Supabase key also changes the seat-token key, which just ends the games in progress.
- **AI Gateway API key:** delete it in the AI Gateway section of the Vercel dashboard (that stops it working at once), create a new one with a budget, put it in your Vercel project's `AI_GATEWAY_API_KEY`, and redeploy.
- **`SESSION_SECRET`:** set a new value and redeploy. Games in progress lose their seats, and nothing else is affected.

## Self-hosting outside Vercel

Set `SESSION_SECRET` (for example `openssl rand -base64 32`) together with the Supabase variables, and serve the site over HTTPS. To use the AI host there, set `AI_GATEWAY_API_KEY` as a server-side secret in your host's dashboard, never in a committed file.
