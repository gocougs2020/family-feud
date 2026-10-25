"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { GameEvent } from "@/lib/types";
import type { PackTheme } from "@/packs/types";

const Scene3D = dynamic(() => import("./scene-3d"), { ssr: false });

let webgl: boolean | null = null;
function hasWebGL() {
  if (webgl === null) {
    try {
      const canvas = document.createElement("canvas");
      webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** 3D scene when the device can handle it, otherwise an animated CSS stage. */
export function Backdrop({ theme, event, enable3d }: { theme: PackTheme; event: GameEvent | null; enable3d: boolean }) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => hasWebGL(),
    () => false,
  );
  return (
    <div className="absolute inset-0">
      <CssBackdrop theme={theme} />
      {enable3d && supported && <Scene3D theme={theme} event={event} />}
    </div>
  );
}

// Deterministic so server and client render the same layout.
const bits = (() => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return {
    stars: Array.from({ length: 90 }, () => ({ x: rand() * 100, y: rand() * 60, s: 1 + rand() * 2, d: rand() * 3 })),
    candles: Array.from({ length: 22 }, () => ({ x: rand() * 100, y: 8 + rand() * 50, d: rand() * 6, s: 0.6 + rand() * 0.7 })),
  };
})();

function CssBackdrop({ theme }: { theme: PackTheme }) {
  const hall = theme.scene === "great-hall";
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background: hall
          ? `radial-gradient(ellipse at 50% 110%, ${theme.colors.bgAlt} 0%, ${theme.colors.bg} 65%)`
          : `radial-gradient(ellipse at 50% 120%, ${theme.colors.bgAlt} 0%, ${theme.colors.bg} 70%)`,
      }}
    >
      {bits.stars.map((s, i) => (
        <span
          key={i}
          className="css-star absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }}
        />
      ))}
      {hall &&
        bits.candles.map((c, i) => (
          <span
            key={i}
            className="css-candle absolute flex flex-col items-center"
            style={{ left: `${c.x}%`, top: `${c.y}%`, animationDelay: `${c.d}s`, transform: `scale(${c.s})` }}
          >
            <span
              className="css-flame block h-4 w-2.5 rounded-full"
              style={{ background: "radial-gradient(circle at 50% 70%, #fff6d0, #ffb347 60%, transparent 70%)", boxShadow: "0 0 18px 6px rgba(255,180,80,0.45)" }}
            />
            <span className="block h-10 w-2 rounded-sm" style={{ background: "linear-gradient(90deg,#d9cba8,#f6eedb,#cbbd99)" }} />
          </span>
        ))}
    </div>
  );
}
