import type { PackTheme } from "../types";

const studioColors: PackTheme["colors"] = {
  bg: "#030a24",
  bgAlt: "#0b2a6b",
  fog: "#04103a",
  panel: "rgba(4, 16, 58, 0.8)",
  tile: "#0c3aa8",
  tileEdge: "#f2c230",
  tileFace: "#1f5be0",
  tileText: "#ffffff",
  accent: "#f2c230",
  accentSoft: "rgba(242, 194, 48, 0.18)",
  text: "#ffffff",
  strike: "#ff3b30",
};

export const classicTheme: PackTheme = {
  id: "classic",
  name: "Classic Feud",
  tagline: "Everyday survey questions",
  description: "We surveyed 100 people. Studio lights, big blue board, the questions you know and love.",
  emoji: "📺",
  hostName: "Danny Delgado",
  audienceLabel: "100 people",
  font: "anton",
  scene: "studio",
  music: "game-show",
  voice: {
    style: "An upbeat, charismatic American TV game show host: big energy, quick and punchy, playing to the studio audience.",
    lang: "en-US",
    rate: 1.05,
    pitch: 1,
    preferNames: ["Alex", "Samantha", "Google US English", "Microsoft Guy"],
  },
  colors: studioColors,
  teams: [
    [
      { name: "The Hendersons", color: "#ff5a36" },
      { name: "The Okafors", color: "#22b8ff" },
    ],
    [
      { name: "Team Sizzle", color: "#ff8a00" },
      { name: "Team Steak", color: "#c03fff" },
    ],
    [
      { name: "The Couch Potatoes", color: "#ff5a36" },
      { name: "The Night Owls", color: "#22b8ff" },
    ],
  ],
  playerColors: ["#f2c230", "#ff5a36", "#22b8ff", "#7bd389", "#c77dff", "#ff8fab", "#ffd166", "#06d6a0"],
};

export const customTheme: PackTheme = {
  ...classicTheme,
  id: "custom",
  name: "Any Topic",
  tagline: "AI writes a survey about anything",
  description: "Type any topic — a TV show, your office, the 90s — and the AI writes a fresh survey for it.",
  emoji: "✨",
  audienceLabel: "100 fans",
  customTopic: true,
  teams: [
    [
      { name: "Team Survey", color: "#ff5a36" },
      { name: "Team Says", color: "#22b8ff" },
    ],
    [
      { name: "The Buzzers", color: "#ff8a00" },
      { name: "The Guessers", color: "#2ad38b" },
    ],
  ],
};
