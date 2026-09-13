// Where the rows come from. Claude accounts are collected natively from
// Claude Code's own files (src/collect/claude.ts). Other agents arrive as
// display-ready JSON records, one file per agent, from a record directory:
// a collector writes one under the state directory, and `--dir` points at
// any other.

import { readdir } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { collectClaude } from "./collect/claude.ts";

const STATE_DIR = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");

// Record directories read when present, for agents agentmeter has no native
// collector for yet (Codex, Fireworks). The first is agentmeter's own; the
// second is where earlier collectors wrote and is kept so existing records
// keep showing up.
export const EXTRA_RECORD_DIRS = [
  join(STATE_DIR, "agentmeter", "usage"),
  join(STATE_DIR, "omarchy", "agents", "usage"),
];

// The directory agentmeter owns: what doctor reports and what the panel
// watches when no `--dir` is given.
export const EXTRA_RECORD_DIR = EXTRA_RECORD_DIRS[0]!;

export type Limit = { label: string; percent: number; resetsAt: string; title?: string };

export type ModelBucket = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type Day = { date: string; messageCount: number };

export type Balance = {
  remaining: number;
  funded: number;
  spent: number;
  currency: string;
  estimated: boolean;
};

export type Provider = {
  id: string;
  name: string;
  ready: boolean;
  hasLocalStats: boolean;
  hasPromptStats: boolean;
  usageStatusText: string;
  authHelpText: string;
  tierLabel: string;
  limits: Limit[];
  balance: Balance | null;
  todayPrompts: number;
  todaySessions: number;
  todayTotalTokens: number;
  recentDays: Day[];
  modelUsage: Record<string, ModelBucket>;
  totalPrompts: number;
  totalSessions: number;
  activeDays: number;
  updatedAt: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

function balanceValue(raw: unknown): Balance | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const remaining = num(b.remaining);
  const funded = num(b.funded);
  if (!(remaining > 0) && !(funded > 0)) return null;
  return {
    remaining,
    funded,
    spent: num(b.spent),
    currency: str(b.currency) || "USD",
    estimated: b.estimated === true,
  };
}

export function normalize(raw: Record<string, unknown>): Provider {
  const limits = Array.isArray(raw.limits)
    ? (raw.limits as Record<string, unknown>[])
        .filter((l) => l && Number(l.percent) >= 0)
        .map((l) => ({
          label: str(l.label),
          percent: num(l.percent),
          resetsAt: str(l.resetsAt),
          title: str(l.title) || undefined,
        }))
    : [];
  const recentDays = Array.isArray(raw.recentDays)
    ? (raw.recentDays as Record<string, unknown>[]).map((d) => ({
        date: str(d.date),
        messageCount: num(d.messageCount),
      }))
    : [];
  const modelUsage: Record<string, ModelBucket> = {};
  if (raw.modelUsage && typeof raw.modelUsage === "object") {
    for (const [id, bucket] of Object.entries(raw.modelUsage as Record<string, Record<string, unknown>>)) {
      modelUsage[id] = {
        inputTokens: num(bucket?.inputTokens),
        outputTokens: num(bucket?.outputTokens),
        cacheReadInputTokens: num(bucket?.cacheReadInputTokens),
        cacheCreationInputTokens: num(bucket?.cacheCreationInputTokens),
      };
    }
  }
  return {
    id: str(raw.id),
    name: str(raw.name) || str(raw.id),
    ready: raw.ready === true,
    hasLocalStats: raw.hasLocalStats !== false,
    hasPromptStats: raw.hasPromptStats !== false,
    usageStatusText: str(raw.usageStatusText),
    authHelpText: str(raw.authHelpText),
    tierLabel: str(raw.tierLabel),
    limits,
    balance: balanceValue(raw.balance),
    todayPrompts: num(raw.todayPrompts),
    todaySessions: num(raw.todaySessions),
    todayTotalTokens: num(raw.todayTotalTokens),
    recentDays,
    modelUsage,
    totalPrompts: num(raw.totalPrompts),
    totalSessions: num(raw.totalSessions),
    activeDays: num(raw.activeDays),
    updatedAt: str(raw.updatedAt),
  };
}

// A subscription appears only when it has actually recorded usage, the same
// rule the bar widget uses to decide whether to draw a tab at all.
export function hasUsage(p: Provider): boolean {
  return (
    p.limits.length > 0 ||
    p.balance !== null ||
    p.totalPrompts > 0 ||
    p.todayTotalTokens > 0 ||
    Object.keys(p.modelUsage).length > 0 ||
    p.recentDays.some((d) => d.messageCount > 0)
  );
}

async function readRecordDir(dir: string): Promise<Provider[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Provider[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      const raw = (await Bun.file(join(dir, name)).json()) as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || !raw.id) continue;
      out.push(normalize(raw));
    } catch {
      // A record mid-write or malformed is skipped until the next change.
    }
  }
  return out;
}

export type LoadOptions = { dir?: string; force?: boolean };

// With `dir`, only that directory's records are shown (fixtures, another
// machine's snapshot). Otherwise: native Claude collection, plus any
// non-Claude records the extra directory holds.
export async function loadProviders(opts: LoadOptions = {}): Promise<Provider[]> {
  let list: Provider[];
  if (opts.dir) {
    list = await readRecordDir(opts.dir);
  } else {
    const native = (await collectClaude(opts.force ?? false)).map(normalize);
    const extra: Provider[] = [];
    const seen = new Set<string>();
    for (const dir of EXTRA_RECORD_DIRS) {
      for (const p of await readRecordDir(dir)) {
        if (p.id.startsWith("claude") || seen.has(p.id)) continue;
        seen.add(p.id);
        extra.push(p);
      }
    }
    list = [...native, ...extra];
  }
  const out = list.filter(hasUsage);
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

// Calls onChange after a record directory settles; records are written
// through a temp file and a rename, so a burst collapses to one reload.
export function watchRecordDir(onChange: () => void, dir: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, { persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 250);
    });
  } catch {
    // Directory missing: nothing to watch until a collector creates it.
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

export type RefreshKind = "normal" | "limits" | "force";
