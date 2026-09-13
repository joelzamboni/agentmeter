import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planLabel, scanTranscripts } from "../src/collect/claude.ts";

beforeAll(async () => {
  process.env.XDG_CACHE_HOME = await mkdtemp(join(tmpdir(), "agentmeter-test-"));
});

describe("transcript scan", () => {
  test("sums usage, drops repeated ids within and across files", async () => {
    const stats = await scanTranscripts("test/claude-home");
    // msg_A twice in one file, msg_C in two files: three distinct messages.
    expect(stats.totalPrompts).toBe(3);
    expect(stats.totalSessions).toBe(2);
    expect(stats.modelUsage["claude-opus-5"]).toEqual({
      inputTokens: 105,
      outputTokens: 55,
      cacheReadInputTokens: 1090,
      cacheCreationInputTokens: 200,
    });
    expect(stats.modelUsage["claude-fable-5-1"]!.cacheReadInputTokens).toBe(300);
    expect(stats.activeDates).toEqual(["2026-09-10", "2026-09-11"]);
  });
  test("second run reuses the cache and agrees", async () => {
    const a = await scanTranscripts("test/claude-home");
    const b = await scanTranscripts("test/claude-home");
    expect(b).toEqual(a);
    const forced = await scanTranscripts("test/claude-home", true);
    expect(forced).toEqual(a);
  });
});

describe("plan label", () => {
  test("from tier or subscription", () => {
    expect(planLabel("default_claude_max_20x", "max")).toBe("Max 20x");
    expect(planLabel("", "pro")).toBe("Pro");
    expect(planLabel("", "")).toBe("");
  });
});
