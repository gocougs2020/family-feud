"use client";

import { useNow } from "@/lib/client/use-game";

/** A shrinking ring around the seconds left until `deadline` (server clock). */
export function Countdown({
  deadline,
  total,
  serverNow,
  size = 64,
  color = "var(--c-accent)",
}: {
  deadline: number;
  total: number;
  serverNow: () => number;
  size?: number;
  color?: string;
}) {
  useNow(200);
  const left = Math.max(0, deadline - serverNow());
  const seconds = Math.ceil(left / 1000);
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const frac = Math.min(1, left / total);
  const urgent = seconds <= 5;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.15)" strokeWidth={5} fill="rgba(0,0,0,0.35)" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? "var(--c-strike)" : color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: "stroke-dashoffset 0.2s linear" }}
        />
      </svg>
      <span className={`absolute font-display tabular-nums ${urgent ? "text-strike" : ""}`} style={{ fontSize: size * 0.36 }}>
        {seconds}
      </span>
    </div>
  );
}
