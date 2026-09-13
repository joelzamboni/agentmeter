import { useApp, useInput, useStdout, Box, Text } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXTRA_RECORD_DIRS, loadProviders, watchRecordDir, type Provider, type RefreshKind } from "../records.ts";
import { bindingWindow, formatClock, weekTotal } from "../format.ts";
import { layoutFor } from "../columns.ts";
import { theme } from "../theme.ts";
import { Table } from "./Table.tsx";
import { Detail } from "./Detail.tsx";

export type AppProps = { once?: boolean; dir?: string; force?: boolean };

export type SortKey = "limit" | "name" | "tokens";
const SORTS: SortKey[] = ["limit", "name", "tokens"];

// Closest to a limit first, so the account that will stop you is on top.
export function sortProviders(list: Provider[], key: SortKey): Provider[] {
  const out = [...list];
  if (key === "name") out.sort((a, b) => a.name.localeCompare(b.name));
  if (key === "tokens") out.sort((a, b) => weekTotal(b) - weekTotal(a));
  if (key === "limit")
    out.sort(
      (a, b) =>
        (bindingWindow(b)?.percent ?? -1) - (bindingWindow(a)?.percent ?? -1) || a.name.localeCompare(b.name),
    );
  return out;
}

export function App({ once = false, dir, force = false }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("limit");
  const [detail, setDetail] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [cols, setCols] = useState(stdout.columns || Number(process.env.COLUMNS) || 80);
  const pending = useRef<RefreshKind | null>(null);

  const reload = useCallback(
    async (force = false) => {
      try {
        setProviders(await loadProviders({ dir, force }));
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    },
    [dir],
  );

  useEffect(() => {
    void reload(force);
    if (once) return;
    // Transcripts change as you work and limits move on the server; the scan
    // is incremental and the limits probe is cached, so this stays cheap.
    const watched = dir ? [dir] : EXTRA_RECORD_DIRS;
    const stops = watched.map((d) => watchRecordDir(() => void reload(), d));
    const collect = setInterval(() => void reload(), 120_000);
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    const onResize = () => setCols(stdout.columns || 80);
    stdout.on("resize", onResize);
    return () => {
      for (const stop of stops) stop();
      clearInterval(collect);
      clearInterval(tick);
      stdout.off("resize", onResize);
    };
  }, [reload, once, dir, force, stdout]);

  // One-shot mode prints the first complete frame and leaves it on screen.
  useEffect(() => {
    if (once && providers !== null) exit();
  }, [once, providers, exit]);

  const runRefresh = useCallback(
    async (kind: RefreshKind) => {
      if (busy) {
        pending.current = kind === "force" ? "force" : pending.current ?? kind;
        return;
      }
      setBusy(true);
      setStatus(kind === "force" ? "rescanning…" : "refreshing…");
      setStatus("");
      await reload(kind === "force");
      setBusy(false);
      setNowMs(Date.now());
      const next = pending.current;
      pending.current = null;
      if (next) void runRefresh(next);
    },
    [busy, reload],
  );

  const sorted = useMemo(() => sortProviders(providers ?? [], sort), [providers, sort]);
  const count = sorted.length;
  // Selection follows the account, not the row, so a re-sort or a record
  // landing mid-session never moves the cursor onto a different account.
  const selected = Math.max(0, sorted.findIndex((p) => p.id === selectedId));
  const current = sorted[selected];

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c") || key.escape) exit();
      if (count === 0) return;
      const move = (delta: number) => setSelectedId(sorted[(selected + delta + count) % count]!.id);
      if (input === "j" || key.downArrow) move(1);
      if (input === "k" || key.upArrow) move(-1);
      if (/^[1-9]$/.test(input) && Number(input) <= count) setSelectedId(sorted[Number(input) - 1]!.id);
      if (key.return || input === "d") setDetail((d) => !d);
      if (input === "s") setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]!);
      if (input === "r") void runRefresh("limits");
      if (input === "R") void runRefresh("force");
    },
    { isActive: !once },
  );

  if (providers === null) return <Text color={theme.dim}>Reading usage records…</Text>;

  if (count === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>No Claude Code usage found on this machine.</Text>
        <Text color={theme.dim}>
          agentmeter reads Claude Code's own files in ~/.claude (or $CLAUDE_CONFIG_DIR). Sign in with `claude` and
          send a prompt, then press r.
        </Text>
      </Box>
    );
  }

  const layout = layoutFor(sorted, cols);
  const updated = current ? formatClock(current.updatedAt) : "";

  return (
    <Box flexDirection="column">
      <Table providers={sorted} layout={layout} nowMs={nowMs} selected={once ? null : selected} />
      {!once && detail && current && <Detail provider={current} nowMs={nowMs} />}
      {!once && (
        <Box marginTop={1} paddingX={1} justifyContent="space-between">
          <Text color={theme.dim} wrap="truncate">
            j/k account · enter detail · s sort: {sort} · r refresh · R rescan · q quit
          </Text>
          <Text color={status && !busy ? theme.warn : theme.dim}>
            {busy || status ? status : updated ? `updated ${updated}` : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}
