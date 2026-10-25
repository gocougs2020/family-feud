// Applies supabase/migrations/*.sql to the database before each build, so a
// fresh fork deployed with the Vercel + Supabase integration needs no manual
// SQL. Skips quietly when no database URL is configured (local memory mode).
//
//   pnpm db:migrate   # run by hand
//
// Uses the first of: POSTGRES_URL_NON_POOLING, DATABASE_URL, POSTGRES_URL
// (the Vercel Supabase integration sets the POSTGRES_* ones).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!url) {
  const supabaseSet = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  console.log(
    supabaseSet
      ? "[migrate] Supabase is configured but no database URL is set (POSTGRES_URL_NON_POOLING). Skipping — run supabase/migrations by hand."
      : "[migrate] No database configured; skipping (games will use in-memory storage).",
  );
  process.exit(0);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { ssl: local ? false : "require", prepare: false, max: 1, onnotice: () => {} });

try {
  await sql`create table if not exists public.feud_migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table public.feud_migrations enable row level security`;
  const applied = new Set((await sql`select name from public.feud_migrations`).map((r) => r.name));

  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.feud_migrations (name) values (${file})`;
    });
    console.log(`[migrate] applied ${file}`);
    ran++;
  }
  console.log(ran ? `[migrate] done (${ran} applied)` : "[migrate] database is up to date");
} catch (err) {
  console.error("[migrate] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
