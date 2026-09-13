// Which limit windows the table has columns for, and which columns survive
// at a given terminal width.

import type { Provider } from "./records.ts";
import { limitWindows } from "./format.ts";

const PREFERRED = ["Session", "Weekly", "Monthly"];

// Union of every account's window titles: Session, Weekly, Monthly first,
// then model-scoped ones like "Fable Weekly" in the order they appear.
export function windowOrder(providers: Provider[]): string[] {
  const seen = new Set<string>();
  for (const p of providers) for (const w of limitWindows(p)) seen.add(w.title);
  const out = PREFERRED.filter((t) => seen.has(t));
  for (const t of seen) if (!out.includes(t)) out.push(t);
  return out;
}

export type Tier = "full" | "noSpark" | "noPlan" | "oneLimit";

export const NAME_MIN = 14;
export const PLAN_W = 8;
export const LIMIT_W = 19;
export const TODAY_W = 7;
export const SPARK_W = 7;
export const TOTAL_W = 7;
export const GAP = 2;
// In the one-limit tier the cell also names its window ("Fable W…").
export const TITLE_W = 8;

export type Layout = {
  tier: Tier;
  nameW: number;
  windows: string[]; // titles with their own column; empty in oneLimit
  showPlan: boolean;
  showSpark: boolean;
  width: number;
};

export function layoutFor(providers: Provider[], cols: number): Layout {
  const nameW = Math.max(NAME_MIN, ...providers.map((p) => p.name.length + 2));
  const order = windowOrder(providers);
  const tiers: Tier[] = ["full", "noSpark", "noPlan", "oneLimit"];
  let chosen: Layout | null = null;
  for (const tier of tiers) {
    const showSpark = tier === "full";
    const showPlan = tier === "full" || tier === "noSpark";
    const windows = tier === "oneLimit" ? [] : order;
    const limitWidth = tier === "oneLimit" ? GAP + TITLE_W + 1 + LIMIT_W : order.length * (GAP + LIMIT_W);
    const width =
      1 +
      nameW +
      (showPlan ? GAP + PLAN_W : 0) +
      limitWidth +
      GAP +
      TODAY_W +
      GAP +
      (showSpark ? SPARK_W + 1 : 0) +
      TOTAL_W +
      1;
    chosen = { tier, nameW, windows, showPlan, showSpark, width };
    if (width <= cols) break;
  }
  return chosen!;
}
