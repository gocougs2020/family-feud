import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayerScreen } from "@/components/play/player-screen";

export const metadata: Metadata = { title: "Play" };

// The phone controller.
export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense>
      {params.then(({ code }) => (
        <PlayerScreen code={code.toUpperCase()} />
      ))}
    </Suspense>
  );
}
