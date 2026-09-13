import { describe, expect, test } from "bun:test";
import {
  formatDurationShort,
  formatResetClock,
  formatTokenCount,
  friendlyModelName,
  pace,
  sparkline,
} from "../src/format.ts";
import { isNewer, assetName } from "../src/update.ts";
import { loadProviders } from "../src/records.ts";
import { compactLine } from "../src/compact.ts";
import { layoutFor } from "../src/columns.ts";

describe("format", () => {
  test("token counts", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(1234)).toBe("1.2K");
    expect(formatTokenCount(1.7e9)).toBe("1.7B");
  });
  test("model names", () => {
    expect(friendlyModelName("claude-fable-5-1")).toBe("Fable 5.1");
    expect(friendlyModelName("claude-opus-4-8-20260101")).toBe("Opus 4.8");
    expect(friendlyModelName("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
  });
  test("short durations", () => {
    expect(formatDurationShort(3 * 3600e3 + 5 * 60e3)).toBe("3h");
    expect(formatDurationShort(2 * 86400e3)).toBe("2d");
    expect(formatDurationShort(-1)).toBe("now");
  });
  test("reset clock times", () => {
    const now = new Date(2026, 8, 13, 9, 0).getTime();
    const at = (ms: number) => ({ title: "Session", label: "Session (5-hour)", percent: 0.5, resetAt: new Date(ms).toISOString() });
    expect(formatResetClock(at(now + 5 * 3600e3), now)).toBe("14:00");
    expect(formatResetClock(at(now + 2 * 86400e3), now)).toBe("Tue 09:00");
    expect(formatResetClock(at(now + 20 * 86400e3), now)).toBe("Oct 3 09:00");
    expect(formatResetClock({ ...at(now), resetAt: "" }, now)).toBe("");
  });
  test("pace against the elapsed window", () => {
    const now = Date.parse("2026-09-13T00:00:00Z");
    const twoDaysLeft = new Date(now + 2 * 86400e3).toISOString();
    const weekly = { title: "Weekly", label: "Weekly (7-day)", resetAt: twoDaysLeft };
    expect(pace({ ...weekly, percent: 0.9 }, now)).toBe("ahead");
    expect(pace({ ...weekly, percent: 0.2 }, now)).toBe("under");
    expect(pace({ ...weekly, percent: 0.2, resetAt: "" }, now)).toBe("unknown");
  });
  test("sparkline pads to seven cells", () => {
    const cells = sparkline([{ date: "a", messageCount: 1 }, { date: "b", messageCount: 4 }]);
    expect(cells).toHaveLength(7);
    expect(cells[6]!.glyph).toBe("█");
    expect(cells[0]!.glyph).toBe(" ");
  });
});

describe("update", () => {
  test("version comparison", () => {
    expect(isNewer("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("v1.0.0", "dev")).toBe(true);
  });
  test("asset name for this host", () => {
    expect(assetName()).toMatch(/^agentmeter-(linux|darwin)-(x64|arm64)$/);
  });
});

describe("records", () => {
  test("fixtures load, hide the empty agent, and render compact", async () => {
    const list = await loadProviders({ dir: "test/fixtures" });
    expect(list.map((p) => p.id)).toEqual(["claude", "claude-work", "fireworks"]);
    expect(compactLine(list)).toBe("claude 4%/10%/18% · work 32%/92%/34%! · fireworks $12.40");
  });
  test("layout tiers step down with width", async () => {
    const list = await loadProviders({ dir: "test/fixtures" });
    expect(layoutFor(list, 200).tier).toBe("full");
    expect(layoutFor(list, 100).tier).toBe("noPlan");
    expect(layoutFor(list, 70).tier).toBe("oneLimit");
  });
});
