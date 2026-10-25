// Client-safe pack registry (themes only). To add a pack, create
// `src/packs/<id>/theme.ts` + `content.ts` and register it here and in
// `src/packs/server.ts`. See docs/creating-a-pack.md.
import { classicTheme, customTheme } from "./classic/theme";
import { harryPotterTheme } from "./harry-potter/theme";
import type { PackTheme } from "./types";

export const packThemes: PackTheme[] = [harryPotterTheme, classicTheme, customTheme];

export const DEFAULT_PACK_ID = harryPotterTheme.id;

export function getPackTheme(id: string): PackTheme {
  return packThemes.find((p) => p.id === id) ?? classicTheme;
}
