// Display helpers ported from the widget's Main.qml and Panel.qml so the
// terminal reads the same way the bar panel does.

import type { Day, ModelBucket, Provider } from "./records.ts";

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function modelWordCase(word: string): string {
  if (word === "gpt") return "GPT";
  if (word === "deepseek") return "DeepSeek";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Model ids arrive hyphenated with the version split across segments
// (`claude-fable-5-1`, `gpt-5.6-sol`). Rejoin the numeric run into one
// version and title-case the words around it.
export function friendlyModelName(id: string): string {
  if (!id) return "Unknown";
  const name = id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const words: string[] = [];
  let version: string[] = [];
  for (const part of name.split("-")) {
    if (part === "") continue;
    if (/^\d/.test(part)) {
      version.push(part);
      continue;
    }
    if (version.length > 0) {
      words.push(version.join("."));
      version = [];
    }
    words.push(modelWordCase(part));
  }
  if (version.length > 0) words.push(version.join("."));
  return words.length > 0 ? words.join(" ") : "Unknown";
}

function windowIsLong(text: string): boolean {
  return /week|7-day|seven|month|30-day/.test(text);
}

function windowSpanMs(label: string): number {
  const text = label.toLowerCase();
  if (/month|30-day/.test(text)) return 30 * 24 * 3600 * 1000;
  if (windowIsLong(text)) return 7 * 24 * 3600 * 1000;
  const hours = text.match(/(\d+)\s*-?\s*h(?:our)?\b/);
  if (hours) return Number(hours[1]) * 3600 * 1000;
  const minutes = text.match(/(\d+)\s*-?\s*m(?:in(?:ute)?s?)?\b/);
  if (minutes) return Number(minutes[1]) * 60 * 1000;
  return 0;
}

function windowTitle(label: string): string {
  const text = label.toLowerCase();
  if (text.includes("month")) return "Monthly";
  if (windowIsLong(text)) return "Weekly";
  if (text.includes("session") || windowSpanMs(label) > 0) return "Session";
  const plain = label.replace(/\s*\(.*\)\s*/, "").trim();
  return plain === "" ? "Limit" : plain;
}

export type LimitWindow = { title: string; label: string; percent: number; resetAt: string };

export function limitWindows(p: Provider): LimitWindow[] {
  return p.limits.map((l) => ({
    title: l.title && l.title !== "" ? l.title : windowTitle(l.label),
    label: l.label,
    percent: l.percent,
    resetAt: l.resetsAt,
  }));
}

// The window that decides how much room is left: the fullest one, since
// that is what stops the next prompt.
export function bindingWindow(p: Provider): LimitWindow | null {
  let best: LimitWindow | null = null;
  for (const w of limitWindows(p)) if (!best || w.percent > best.percent) best = w;
  return best;
}

export function providerAlarming(p: Provider): boolean {
  const w = bindingWindow(p);
  if (w && w.percent >= 0.9) return true;
  const b = p.balance;
  return !!b && b.funded > 0 && b.remaining / b.funded <= 0.1;
}

export function resetMs(w: LimitWindow, nowMs: number): number {
  if (w.resetAt === "") return -1;
  const ms = new Date(w.resetAt).getTime();
  return Number.isFinite(ms) ? ms - nowMs : -1;
}

export function formatDuration(ms: number): string {
  if (!(ms > 0)) return "now";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function currencyPrefix(currency: string): string {
  const code = currency.toUpperCase();
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  if (code === "GBP") return "£";
  return code + " ";
}

export function formatMoney(value: number, currency: string): string {
  return currencyPrefix(currency) + value.toFixed(2);
}

export function heroMeta(p: Provider): string {
  if (p.usageStatusText !== "") return p.usageStatusText;
  if (p.tierLabel === "") return "Subscription";
  return p.tierLabel.charAt(0).toUpperCase() + p.tierLabel.slice(1);
}

export function todayDate(nowMs: number): string {
  const now = new Date(nowMs);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function dayName(date: string): string {
  const parsed = new Date(date + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return date;
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.getDay()]!;
}

export function dayLabel(day: Day, today: boolean): string {
  return today ? "Today" : dayName(day.date);
}

export function dayDetail(day: Day, today: boolean, p: Provider): string {
  const parsed = new Date(day.date + "T00:00:00");
  const label = Number.isNaN(parsed.getTime())
    ? day.date
    : `${dayName(day.date)} ${parsed.getMonth() + 1}/${parsed.getDate()}`;
  let text = `${label} · ${formatTokenCount(day.messageCount)} tokens`;
  if (today && p.hasPromptStats) text += ` · ${p.todayPrompts} prompts · ${p.todaySessions} sessions`;
  return text;
}

export function weekPeak(p: Provider): number {
  return p.recentDays.reduce((peak, d) => Math.max(peak, d.messageCount), 0);
}

export type ModelRow = {
  id: string;
  name: string;
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function modelRows(p: Provider, limit = 4): ModelRow[] {
  const rows: ModelRow[] = Object.entries(p.modelUsage).map(([id, b]: [string, ModelBucket]) => ({
    id,
    name: friendlyModelName(id),
    total: b.inputTokens + b.outputTokens + b.cacheReadInputTokens + b.cacheCreationInputTokens,
    input: b.inputTokens,
    output: b.outputTokens,
    cacheRead: b.cacheReadInputTokens,
    cacheWrite: b.cacheCreationInputTokens,
  }));
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, limit);
}

export function modelDetail(row: ModelRow): string {
  return (
    `in ${formatTokenCount(row.input)} · out ${formatTokenCount(row.output)}` +
    ` · cache read ${formatTokenCount(row.cacheRead)} · cache write ${formatTokenCount(row.cacheWrite)}`
  );
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ table

export { windowSpanMs };

// Short enough for a table cell: "2h", "5d", "45m".
export function formatDurationShort(ms: number): string {
  if (!(ms > 0)) return "now";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 99) return ">99d";
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

// When the window turns over, in local time: "18:00" for later today,
// "Mon 09:00" within the coming week, "Sep 20 09:00" beyond it. Empty when
// the record carries no reset.
export function formatResetClock(w: LimitWindow, nowMs: number): string {
  if (w.resetAt === "") return "";
  const at = new Date(w.resetAt);
  const ms = at.getTime();
  if (!Number.isFinite(ms)) return "";
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (todayDate(ms) === todayDate(nowMs)) return clock;
  if (ms - nowMs < 6 * 86400e3) return `${dayName(todayDate(ms))} ${clock}`;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][at.getMonth()]!;
  return `${month} ${at.getDate()} ${clock}`;
}

export type Pace = "ahead" | "under" | "unknown";

// How the window is being spent against the clock. `ahead` means usage has
// outrun the elapsed share of the window, so the limit lands before the reset
// does at the current rate; `under` means there is room to spare.
export function pace(w: LimitWindow, nowMs: number): Pace {
  const span = windowSpanMs(w.label) || windowSpanMs(w.title);
  const remaining = resetMs(w, nowMs);
  if (span <= 0 || remaining < 0) return "unknown";
  const elapsed = Math.max(0, Math.min(1, 1 - remaining / span));
  if (elapsed < 0.05 || w.percent <= 0) return "unknown";
  return w.percent > elapsed ? "ahead" : "under";
}

const SPARK = "▁▂▃▄▅▆▇█";

// One glyph per day, scaled to the busiest day. Always `length` wide so the
// column lines up when an account has fewer days on record.
export function sparkline(days: Day[], length = 7): { glyph: string; zero: boolean }[] {
  const recent = days.slice(-length);
  const peak = recent.reduce((m, d) => Math.max(m, d.messageCount), 0);
  const cells = recent.map((d) => {
    if (d.messageCount <= 0 || peak <= 0) return { glyph: SPARK[0]!, zero: true };
    const level = Math.max(1, Math.round((d.messageCount / peak) * (SPARK.length - 1)));
    return { glyph: SPARK[level]!, zero: false };
  });
  while (cells.length < length) cells.unshift({ glyph: " ", zero: true });
  return cells;
}

export function weekTotal(p: Provider): number {
  return p.recentDays.reduce((sum, d) => sum + d.messageCount, 0);
}

// "Claude · Webera" → "webera", "Claude Code" → "claude": the label the
// compact one-liner and the waybar module use.
export function shortName(p: Provider): string {
  const parts = p.name.split("·").map((s) => s.trim());
  const tail = parts.length > 1 ? parts[parts.length - 1]! : p.id.split("-")[0]!;
  return tail.toLowerCase().replace(/\s+/g, "-");
}

// Sign-in trouble and endpoint failures come through usageStatusText; a
// record that is not ready has no live limits at all.
export type Health = "live" | "stale" | "alarm";

export function health(p: Provider): Health {
  if (providerAlarming(p)) return "alarm";
  if (!p.ready || p.usageStatusText !== "") return "stale";
  return "live";
}
