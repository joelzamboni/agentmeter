import { Box, Text } from "ink";
import type { Provider } from "../records.ts";
import {
  dayName,
  formatDuration,
  formatResetClock,
  formatTokenCount,
  heroMeta,
  limitWindows,
  modelRows,
  resetMs,
  todayDate,
} from "../format.ts";
import { accentFor, theme } from "../theme.ts";

// The selected account, once: who it is, the week by day, and the model
// split with input / output / cache detail.
export function Detail({ provider, nowMs }: { provider: Provider; nowMs: number }) {
  const accent = accentFor(provider.id);
  const today = todayDate(nowMs);
  const rows = modelRows(provider);
  const nameW = Math.max(8, ...rows.map((r) => r.name.length));
  // Every window that carries a reset, as a wall clock time with the
  // countdown the table already shows beside it.
  const resets = limitWindows(provider).filter((w) => formatResetClock(w, nowMs) !== "");
  const resetNameW = Math.max(8, ...resets.map((w) => w.title.length));
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
      <Text>
        <Text color={accent} bold>
          {provider.name}
        </Text>
        <Text color={theme.dim}>
          {" · "}
          {heroMeta(provider)}
          {provider.hasPromptStats
            ? ` · ${provider.todayPrompts} prompts · ${provider.todaySessions} sessions today`
            : ""}
        </Text>
      </Text>
      {resets.map((w) => {
        const ms = resetMs(w, nowMs);
        return (
          <Text key={w.title}>
            {"  "}
            <Text color={theme.fg}>{w.title.padEnd(resetNameW)}</Text>
            <Text color={theme.dim}>
              {" resets "}
              {formatResetClock(w, nowMs)}
              {ms < 0 ? " (passed)" : ` (in ${formatDuration(ms)})`}
            </Text>
          </Text>
        );
      })}
      {provider.recentDays.length > 0 && (
        <Text>
          {"  "}
          {provider.recentDays.map((d, i) => {
            const isToday = d.date === today;
            return (
              <Text key={d.date}>
                <Text color={isToday ? theme.fg : theme.dim} bold={isToday}>
                  {isToday ? "Today" : dayName(d.date)}
                </Text>
                <Text color={isToday ? theme.fg : theme.dim}> {formatTokenCount(d.messageCount)}</Text>
                {i < provider.recentDays.length - 1 ? <Text color={theme.muted}>   </Text> : null}
              </Text>
            );
          })}
        </Text>
      )}
      {rows.map((r) => (
        <Text key={r.id}>
          {"  "}
          <Text color={theme.fg}>{r.name.padEnd(nameW)}</Text>
          <Text bold> {formatTokenCount(r.total).padStart(7)}</Text>
          <Text color={theme.dim}>
            {"   in "}
            {formatTokenCount(r.input).padEnd(7)}
            {" out "}
            {formatTokenCount(r.output).padEnd(7)}
            {" cache read "}
            {formatTokenCount(r.cacheRead).padEnd(7)}
            {" cache write "}
            {formatTokenCount(r.cacheWrite)}
          </Text>
        </Text>
      ))}
      {provider.authHelpText !== "" && (provider.usageStatusText !== "" || !provider.ready) && (
        <Text color={theme.warn}>
          {"  "}
          {provider.authHelpText}
        </Text>
      )}
    </Box>
  );
}
