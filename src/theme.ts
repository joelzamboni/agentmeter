// One palette for the whole panel. Provider accents follow the marks the
// widget ships; meter colors follow how much room is left.

export const theme = {
  fg: "#e6e6e6",
  dim: "#7a7f8a",
  muted: "#4b505b",
  border: "#3a3f4a",
  borderActive: "#8a93a6",
  ok: "#7fd18a",
  warn: "#e7c46b",
  danger: "#e5736b",
  track: "#2e323b",
  today: "#ffffff",
} as const;

const accents: Record<string, string> = {
  claude: "#d97757",
  codex: "#d9d9d9",
  fireworks: "#8b6cff",
};

export function accentFor(id: string): string {
  const base = id.split("-")[0] ?? id;
  return accents[base] ?? "#9aa5ce";
}

// Green while there is room, amber as the window fills, red when the next
// prompt is at risk: the same thresholds the bar icon uses to light up.
export function meterColor(fraction: number): string {
  if (fraction >= 0.9) return theme.danger;
  if (fraction >= 0.7) return theme.warn;
  return theme.ok;
}
