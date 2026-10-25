import type { Metadata } from "next";
import { Suspense } from "react";
import { HostScreen } from "@/components/host/host-screen";

export const metadata: Metadata = { title: "On air" };

// The TV / big screen.
export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense>
      {params.then(({ code }) => (
        <HostScreen code={code.toUpperCase()} />
      ))}
    </Suspense>
  );
}
