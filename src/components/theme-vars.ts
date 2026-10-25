import type { CSSProperties } from "react";
import type { TeamState } from "@/lib/types";
import type { PackTheme } from "@/packs/types";

/** CSS custom properties for a pack (and this game's team colors), consumed by globals.css / Tailwind tokens. */
export function themeVars(theme: PackTheme, teams?: [TeamState, TeamState]): CSSProperties {
  const [team0, team1] = teams ?? theme.teams[0];
  const c = theme.colors;
  return {
    "--c-bg": c.bg,
    "--c-bg-alt": c.bgAlt,
    "--c-panel": c.panel,
    "--c-tile": c.tile,
    "--c-tile-edge": c.tileEdge,
    "--c-tile-face": c.tileFace,
    "--c-tile-text": c.tileText,
    "--c-accent": c.accent,
    "--c-accent-soft": c.accentSoft,
    "--c-text": c.text,
    "--c-strike": c.strike,
    "--c-team-0": team0.color,
    "--c-team-1": team1.color,
    "--font-display": theme.font === "cinzel" ? "var(--font-cinzel)" : "var(--font-anton)",
  } as CSSProperties;
}
