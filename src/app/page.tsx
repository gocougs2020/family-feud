import { connection } from "next/server";
import { Suspense } from "react";
import { Home } from "@/components/home";
import { aiEnabled } from "@/lib/ai";
import { supabaseConfigured } from "@/lib/store/supabase";

export default function Page() {
  return (
    <Suspense>
      <HomeWithStatus />
    </Suspense>
  );
}

async function HomeWithStatus() {
  await connection(); // read env at request time so status reflects the deployment
  return (
    <Home
      status={{ realtime: supabaseConfigured() ? "supabase" : "local", ai: aiEnabled(), deployed: Boolean(process.env.VERCEL) }}
    />
  );
}
