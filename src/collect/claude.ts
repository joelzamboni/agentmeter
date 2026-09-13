// Native Claude Code collection: every signed-in account on this machine,
// its transcripts under <config dir>/projects, and the authoritative rate
// limits from Anthropic's OAuth usage endpoint. It needs nothing but Claude
// Code itself.
//
// A machine signed in to more than one account keeps each in its own config
// directory (`CLAUDE_CONFIG_DIR=~/.claude-work claude`); every `~/.claude-*`
// directory holding a sign-in becomes its own row.

import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { cacheDir, readJson, shortHash, writeJson } from "./cache.ts";

const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const PROBE_MIN_INTERVAL_MS = 15_000;
const AUTH_HELP = "Run `claude auth login` to restore authoritative usage.";

// ------------------------------------------------------------------ accounts

export type Account = { id: string; name: string; dir: string; isDefault: boolean };

function expand(p: string): string {
  return resolve(p.replace(/^~(?=$|\/)/, homedir()));
}

export function defaultClaudeDir(): string {
  return expand(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// The directory's own `.claude.json` says which account it is; the default
// directory's lives at `~/.claude.json` instead. Two directories signed in to
// the same account are shown once.
async function accountIdentity(dir: string, isDefault: boolean): Promise<string> {
  const candidates = [join(dir, ".claude.json")];
  if (isDefault) candidates.push(join(homedir(), ".claude.json"));
  for (const path of candidates) {
    const data = await readJson<{ oauthAccount?: { accountUuid?: string; emailAddress?: string } }>(path);
    const acct = data?.oauthAccount;
    const id = String(acct?.accountUuid || acct?.emailAddress || "").trim();
    if (id) return id;
  }
  return "";
}

export async function discoverAccounts(): Promise<Account[]> {
  const def = defaultClaudeDir();
  const out: Account[] = [{ id: "claude", name: "Claude Code", dir: def, isDefault: true }];
  const seen = new Set([await accountIdentity(def, true)]);
  let names: string[] = [];
  try {
    names = (await readdir(homedir())).filter((n) => n.startsWith(".claude-")).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const dir = resolve(join(homedir(), name));
    if (dir === def || !(await exists(join(dir, ".credentials.json")))) continue;
    const suffix = name.slice(".claude-".length).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
    if (!suffix) continue;
    const identity = await accountIdentity(dir, false);
    if (identity && seen.has(identity)) continue;
    seen.add(identity);
    out.push({ id: `claude-${suffix}`, name: `Claude · ${suffix}`, dir, isDefault: false });
  }
  return out;
}

// --------------------------------------------------------------- transcripts

type Bucket = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };
// [message id, local date, model, input, output, cache read, cache write]
type Msg = [string, string, string, number, number, number, number];
type FileSummary = { size: number; mtimeMs: number; sessions: string[]; messages: Msg[] };
type ScanCache = { version: 2; files: Record<string, FileSummary> };

const emptyBucket = (): Bucket => ({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateOf(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  const d = typeof value === "number" ? new Date(value > 1e10 ? value : value * 1000) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? fallback : localDate(d);
}

const tok = (u: Record<string, unknown>, snake: string, camel: string): number => {
  const n = Number(u[snake] ?? u[camel] ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// One transcript: every assistant message with a usage block. Ids are kept
// so the aggregate can drop a message that appears in more than one file
// (streamed chunks repeat an id; subagent transcripts get copied between
// project directories).
async function summarizeFile(path: string, size: number, mtimeMs: number): Promise<FileSummary> {
  const out: FileSummary = { size, mtimeMs, sessions: [], messages: [] };
  const sessions = new Set<string>();
  const seen = new Set<string>();
  const today = localDate(new Date());
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return out;
  }
  let start = 0;
  let lineNo = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    lineNo++;
    if (!line.includes('"usage":')) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = (entry.message && typeof entry.message === "object" ? entry.message : {}) as Record<string, unknown>;
    if (entry.type !== "assistant" && message.role !== "assistant") continue;
    const usage = (message.usage ?? entry.usage) as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== "object") continue;
    const key = String(message.id || entry.messageId || "") || `${entry.uuid ?? entry.requestId ?? lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const input = tok(usage, "input_tokens", "inputTokens");
    const output = tok(usage, "output_tokens", "outputTokens");
    const cacheRead = tok(usage, "cache_read_input_tokens", "cacheReadInputTokens");
    const cacheWrite = tok(usage, "cache_creation_input_tokens", "cacheCreationInputTokens");
    const total = input + output + cacheRead + cacheWrite;
    if (total <= 0) continue;

    const model = String(message.model || entry.model || "claude");
    const day = dateOf(entry.timestamp ?? message.timestamp, today);
    sessions.add(String(entry.sessionId || path));
    out.messages.push([key, day, model, input, output, cacheRead, cacheWrite]);
  }
  out.sessions = [...sessions];
  return out;
}

async function* jsonlFiles(root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}

export type Stats = {
  todayPrompts: number;
  todaySessions: number;
  todayTotalTokens: number;
  todayTokensByModel: Record<string, number>;
  recentDays: { date: string; messageCount: number }[];
  modelUsage: Record<string, Bucket>;
  totalPrompts: number;
  totalSessions: number;
  activeDays: number;
  activeDates: string[];
};

// Scans <dir>/projects, re-reading only files whose size or mtime changed
// since the last run. The per-file summaries live in the cache, so a second
// run over a multi-gigabyte history costs a directory walk.
export async function scanTranscripts(claudeDir: string, force = false): Promise<Stats> {
  const projects = join(claudeDir, "projects");
  const cachePath = join(cacheDir(), `claude-scan-${shortHash(projects)}.json`);
  const stored = !force ? await readJson<ScanCache>(cachePath) : null;
  const cache: ScanCache = stored && stored.version === 2 ? stored : { version: 2, files: {} };
  const next: ScanCache = { version: 2, files: {} };
  let changed = false;

  for await (const path of jsonlFiles(projects)) {
    let s;
    try {
      s = await stat(path);
    } catch {
      continue;
    }
    const prev = cache.files[path];
    if (prev && prev.size === s.size && prev.mtimeMs === s.mtimeMs) {
      next.files[path] = prev;
      continue;
    }
    next.files[path] = await summarizeFile(path, s.size, s.mtimeMs);
    changed = true;
  }
  if (changed || Object.keys(cache.files).length !== Object.keys(next.files).length) {
    await writeJson(cachePath, next).catch(() => {});
  }

  const today = localDate(new Date());
  const recentDates: string[] = [];
  for (let i = 6; i >= 0; i--) recentDates.push(localDate(new Date(Date.now() - i * 86_400_000)));
  const recent: Record<string, number> = Object.fromEntries(recentDates.map((d) => [d, 0]));
  const sessions = new Set<string>();
  const todaySessions = new Set<string>();
  const activeDates = new Set<string>();
  const modelUsage: Record<string, Bucket> = {};
  const todayTokensByModel: Record<string, number> = {};
  let prompts = 0;
  let todayPrompts = 0;
  let todayTotal = 0;
  const seen = new Set<string>();

  // Files in path order so a message copied into a second file always
  // counts toward the same one.
  for (const path of Object.keys(next.files).sort()) {
    const f = next.files[path]!;
    for (const s of f.sessions) sessions.add(s);
    for (const [id, day, model, input, output, cacheRead, cacheWrite] of f.messages) {
      if (id.startsWith("msg_") || id.length > 12) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const total = input + output + cacheRead + cacheWrite;
      prompts++;
      activeDates.add(day);
      const acc = (modelUsage[model] ??= emptyBucket());
      acc.inputTokens += input;
      acc.outputTokens += output;
      acc.cacheReadInputTokens += cacheRead;
      acc.cacheCreationInputTokens += cacheWrite;
      if (day in recent) recent[day]! += total;
      if (day === today) {
        todayPrompts++;
        todayTotal += total;
        for (const s of f.sessions) todaySessions.add(s);
        todayTokensByModel[model] = (todayTokensByModel[model] ?? 0) + total;
      }
    }
  }

  return {
    todayPrompts,
    todaySessions: todaySessions.size,
    todayTotalTokens: todayTotal,
    todayTokensByModel,
    recentDays: recentDates.map((date) => ({ date, messageCount: recent[date]! })),
    modelUsage,
    totalPrompts: prompts,
    totalSessions: sessions.size,
    activeDays: activeDates.size,
    activeDates: [...activeDates].sort(),
  };
}

// Claude Code keeps aggregate counters in stats-cache.json for machines whose
// transcripts are gone; only consulted when the scan finds nothing.
async function statsCacheFallback(claudeDir: string): Promise<Stats | null> {
  const data = await readJson<Record<string, any>>(join(claudeDir, "stats-cache.json"));
  if (!data) return null;
  const today = localDate(new Date());
  const todayEntry = (data.dailyModelTokens ?? []).find((e: any) => e?.date === today);
  const todayTokens: Record<string, number> = todayEntry?.tokensByModel ?? {};
  const daily = ((data.dailyActivity ?? []) as any[]).filter((d) => d && typeof d === "object");
  const activeDates = [...new Set(daily.filter((d) => Number(d.messageCount) > 0 && d.date).map((d) => String(d.date)))].sort();
  return {
    todayPrompts: 0,
    todaySessions: 0,
    todayTotalTokens: Object.values(todayTokens).reduce((s, v) => s + Number(v || 0), 0),
    todayTokensByModel: todayTokens,
    recentDays: daily.slice(-7).map((d) => ({ date: String(d.date), messageCount: Number(d.messageCount || 0) })),
    modelUsage: data.modelUsage ?? {},
    totalPrompts: Number(data.totalMessages || 0),
    totalSessions: Number(data.totalSessions || 0),
    activeDays: activeDates.length,
    activeDates,
  };
}

// ------------------------------------------------------------------- limits

type Limit = { label: string; percent: number; resetsAt: string; title?: string };
export type Login = { accessToken: string; expiresAt: number; plan: string; source: "file" | "keychain" | "none" };

const KEYCHAIN_SERVICE = "Claude Code-credentials";

// On macOS the CLI stores the sign-in in the login Keychain instead of a
// file. `security` prints the secret to stdout; it is parsed and used for
// the Authorization header only.
async function keychainLogin(): Promise<Record<string, unknown> | null> {
  if (process.platform !== "darwin") return null;
  try {
    const proc = Bun.spawn(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [code, text] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    if (code !== 0) return null;
    const raw = text.trim();
    // A secret stored as data comes back hex-encoded.
    const json = /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0 ? Buffer.from(raw, "hex").toString("utf8") : raw;
    const data = JSON.parse(json) as { claudeAiOauth?: Record<string, unknown> };
    return data?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

// Only the token, its expiry and a display-safe plan label leave the
// credential store; the token goes nowhere but the Authorization header.
export async function oauthLogin(claudeDir: string, isDefault = true): Promise<Login> {
  const none: Login = { accessToken: "", expiresAt: 0, plan: "", source: "none" };
  const data = await readJson<{ claudeAiOauth?: Record<string, unknown> }>(join(claudeDir, ".credentials.json"));
  let login = data?.claudeAiOauth ?? null;
  let source: Login["source"] = login ? "file" : "none";
  // The Keychain entry is not tied to a config directory, so only the
  // default account reads it; a second account on macOS keeps the file.
  if (!login && isDefault) {
    login = await keychainLogin();
    if (login) source = "keychain";
  }
  if (!login) return none;
  return {
    accessToken: String(login.accessToken || ""),
    expiresAt: Number(login.expiresAt || 0),
    plan: planLabel(String(login.rateLimitTier || ""), String(login.subscriptionType || "")),
    source,
  };
}

export function planLabel(tier: string, subscription: string): string {
  const m = tier.match(/max_(\d+x)/i);
  if (m) return `Max ${m[1]}`;
  if (subscription) return subscription.charAt(0).toUpperCase() + subscription.slice(1);
  return "";
}

const parseUtil = (v: unknown): number => {
  const n = Number(String(v ?? "").trim().replace("%", ""));
  return Number.isFinite(n) ? n : NaN;
};

// The endpoint reports percentages (37.0); older payloads used fractions
// (0.37). Any value >= 1 in the payload means percent scale.
function normalizeUtil(v: unknown, percentScale: boolean): number {
  const n = parseUtil(v);
  if (!(n >= 0)) return -1;
  if (percentScale || n > 1) return Math.min(1, n / 100);
  return Math.min(1, n);
}

function normalizeReset(v: unknown): string {
  if (v === undefined || v === null) return "";
  const raw = String(v).trim();
  if (raw === "") return "";
  if (/^\d+$/.test(raw)) {
    let ts = Number(raw);
    if (ts < 1e12) ts *= 1000;
    return new Date(ts).toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

function scopedWindow(kind: string): string {
  const t = kind.toLowerCase();
  if (t.includes("month")) return "Monthly";
  if (t.includes("week") || t.includes("day")) return "Weekly";
  if (t.includes("hour") || t.includes("session")) return "Session";
  return "";
}

// Model-scoped allowances (a weekly window only one model draws from) only
// appear in the payload's `limits` array; the title carries the window so the
// table never has to parse it back out of a model name.
function scopedLimits(payload: any, percentScale: boolean): Limit[] {
  const entries = Array.isArray(payload.limits) ? payload.limits : [];
  const out: Limit[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const model = e?.scope?.model;
    if (!model || typeof model !== "object") continue;
    const name = String(model.display_name || model.id || "").trim();
    const kind = String(e.kind || "").trim();
    if (!name || seen.has(name + "|" + kind)) continue;
    const percent = normalizeUtil(e.percent, percentScale);
    if (percent < 0) continue;
    seen.add(name + "|" + kind);
    const window = scopedWindow(kind);
    const title = window ? `${name} ${window}` : name;
    out.push({ label: title, title, percent, resetsAt: normalizeReset(e.resets_at) });
  }
  return out;
}

export type Probe = { ok: true; limits: Limit[] } | { ok: false; helpText: string; transport?: boolean };

export async function probeLimits(accessToken: string): Promise<Probe> {
  let payload: any;
  try {
    const res = await fetch(USAGE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const retry = res.headers.get("retry-after") || "";
      return {
        ok: false,
        helpText:
          res.status === 429
            ? `Anthropic's usage endpoint is rate limiting checks right now${retry ? ` (retry after ${retry}s)` : ""}. Local stats are still shown.`
            : `Anthropic's usage endpoint returned status ${res.status}. Local stats are still shown.`,
      };
    }
    payload = await res.json();
  } catch {
    return { ok: false, transport: true, helpText: "Couldn't reach Anthropic's usage endpoint. Local stats are still shown." };
  }
  const weekly = payload.seven_day_oauth_apps ?? payload.seven_day;
  const session = payload.five_hour;
  const raw: unknown[] = [session?.utilization, weekly?.utilization];
  if (Array.isArray(payload.limits)) for (const e of payload.limits) raw.push(e?.percent);
  const percentScale = raw.some((v) => parseUtil(v) >= 1);
  const limits: Limit[] = [];
  if (session && typeof session === "object") {
    const p = normalizeUtil(session.utilization, percentScale);
    if (p >= 0) limits.push({ label: "Session (5-hour)", percent: p, resetsAt: normalizeReset(session.resets_at) });
  }
  if (weekly && typeof weekly === "object") {
    const p = normalizeUtil(weekly.utilization, percentScale);
    if (p >= 0) limits.push({ label: "Weekly (7-day)", percent: p, resetsAt: normalizeReset(weekly.resets_at) });
  }
  limits.push(...scopedLimits(payload, percentScale));
  if (limits.length === 0) return { ok: false, helpText: "Anthropic's usage endpoint returned no limits. Local stats are still shown." };
  return { ok: true, limits };
}

// A cached percentage stays useful until its window rolls over.
function openWindows(limits: Limit[] | undefined, nowMs: number): Limit[] {
  return (limits ?? []).filter((l) => {
    if (!l.resetsAt) return true;
    const t = new Date(l.resetsAt).getTime();
    return Number.isNaN(t) || t > nowMs;
  });
}

type LimitsResult = { limits: Limit[]; usageStatusText: string; authHelpText: string };

async function collectLimits(login: Login, cacheKey: string, force: boolean): Promise<LimitsResult> {
  const cachePath = join(cacheDir(), `claude-limits-${cacheKey}.json`);
  const cached = (await readJson<{ fetchedAtMs: number; limits: Limit[] }>(cachePath)) ?? { fetchedAtMs: 0, limits: [] };
  const now = Date.now();
  const fallback = openWindows(cached.limits, now);

  if (login.accessToken === "") {
    return { limits: fallback, usageStatusText: "Waiting for auth", authHelpText: AUTH_HELP };
  }
  if (login.expiresAt > 0 && login.expiresAt <= now) {
    return {
      limits: fallback,
      usageStatusText: "Sign-in expired",
      authHelpText: `Claude Code's saved sign-in expired${fallback.length ? " — showing the last known limits." : "."} Start Claude Code, or run \`claude auth login\`, to refresh it.`,
    };
  }
  if (fallback.length && !force && now - cached.fetchedAtMs < PROBE_MIN_INTERVAL_MS) {
    return { limits: fallback, usageStatusText: "", authHelpText: AUTH_HELP };
  }
  const probe = await probeLimits(login.accessToken);
  if (probe.ok) {
    await writeJson(cachePath, { fetchedAtMs: now, limits: probe.limits }).catch(() => {});
    return { limits: probe.limits, usageStatusText: "", authHelpText: AUTH_HELP };
  }
  if (fallback.length) return { limits: fallback, usageStatusText: "", authHelpText: AUTH_HELP };
  return { limits: [], usageStatusText: "Claude limits unavailable", authHelpText: probe.helpText };
}

// ------------------------------------------------------------------- record

export async function collectAccount(account: Account, force = false): Promise<Record<string, unknown>> {
  let stats = await scanTranscripts(account.dir, force);
  if (stats.totalPrompts <= 0) stats = (await statsCacheFallback(account.dir)) ?? stats;
  const login = await oauthLogin(account.dir, account.isDefault);
  const limits = await collectLimits(login, account.isDefault ? "default" : account.id, force);
  return {
    schemaVersion: 1,
    id: account.id,
    name: account.name,
    updatedAt: new Date().toISOString(),
    ready: stats.totalPrompts > 0 || limits.limits.length > 0,
    hasLocalStats: true,
    tierLabel: login.plan,
    ...limits,
    ...stats,
  };
}

export async function collectClaude(force = false): Promise<Record<string, unknown>[]> {
  const accounts = await discoverAccounts();
  return Promise.all(accounts.map((a) => collectAccount(a, force)));
}
