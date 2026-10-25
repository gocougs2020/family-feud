import type { PackTheme } from "../types";

const gryffindor = { name: "Gryffindor", color: "#c8322b" };
const slytherin = { name: "Slytherin", color: "#2a9d5c" };
const ravenclaw = { name: "Ravenclaw", color: "#3a6fd8" };
const hufflepuff = { name: "Hufflepuff", color: "#e0b31f" };

export const harryPotterTheme: PackTheme = {
  id: "harry-potter",
  name: "The Wizarding Feud",
  tagline: "A Harry Potter fan pack",
  description:
    "We surveyed 100 witches and wizards. Floating candles, an enchanted ceiling, and questions about spells, creatures and life at Hogwarts.",
  emoji: "🪄",
  hostName: "Professor Bartholomew Quill",
  audienceLabel: "100 witches and wizards",
  font: "cinzel",
  scene: "great-hall",
  music: "mystic-waltz",
  voice: {
    style:
      "A warm, theatrical older British professor hosting a game show: playful, a little eccentric, building suspense before reveals and delighting in big moments.",
    lang: "en-GB",
    rate: 1.02,
    pitch: 0.95,
    preferNames: ["Daniel", "Arthur", "Oliver", "Google UK English Male", "Microsoft Ryan", "Serena"],
  },
  colors: {
    bg: "#07091a",
    bgAlt: "#1a0f2e",
    fog: "#0d0b22",
    panel: "rgba(14, 12, 36, 0.78)",
    tile: "#14204a",
    tileEdge: "#c9a24a",
    tileFace: "#f3e6c4",
    tileText: "#2a1606",
    accent: "#e8c35a",
    accentSoft: "rgba(232, 195, 90, 0.18)",
    text: "#f6eedb",
    strike: "#e0473c",
  },
  teams: [
    [gryffindor, slytherin],
    [ravenclaw, hufflepuff],
    [gryffindor, ravenclaw],
    [hufflepuff, slytherin],
    [gryffindor, hufflepuff],
    [ravenclaw, slytherin],
  ],
  playerColors: ["#e8c35a", "#c0392b", "#2e8b57", "#3b6fd8", "#9b59b6", "#e67e22", "#1abc9c", "#ec87c0"],
};
