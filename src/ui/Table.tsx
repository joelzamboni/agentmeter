import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { Provider } from "../records.ts";
import {
  bindingWindow,
  formatDurationShort,
  formatPercent,
  formatTokenCount,
  health,
  heroMeta,
  limitWindows,
  pace,
  resetMs,
  sparkline,
  weekTotal,
  type LimitWindow,
} from "../format.ts";
import { GAP, LIMIT_W, PLAN_W, SPARK_W, TITLE_W, TODAY_W, TOTAL_W, type Layout } from "../columns.ts";
import { accentFor, meterColor, theme } from "../theme.ts";

const METER_W = 8;

type Props = {
  providers: Provider[];
  layout: Layout;
  nowMs: number;
  selected: number | null;
};

function Cell({ width, align = "left", children }: { width: number; align?: "left" | "right"; children: ReactNode }) {
  return (
    <Box width={width} marginLeft={GAP} justifyContent={align === "right" ? "flex-end" : "flex-start"} flexShrink={0}>
      {children}
    </Box>
  );
}

function Header({ text, width, align }: { text: string; width: number; align?: "left" | "right" }) {
  return (
    <Cell width={width} align={align}>
      <Text color={theme.dim} wrap="truncate">
        {text.toUpperCase()}
      </Text>
    </Cell>
  );
}

function Meter({ fraction, color, drain = false }: { fraction: number; color: string; drain?: boolean }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  let filled = Math.round(clamped * METER_W);
  if (clamped > 0 && filled === 0) filled = 1;
  const on = drain ? METER_W - filled : filled;
  return (
    <Text>
      <Text color={color}>{"▰".repeat(on)}</Text>
      <Text color={theme.track}>{"▱".repeat(METER_W - on)}</Text>
    </Text>
  );
}

// "▰▰▰▱▱▱▱▱ 57%▲ 3d": meter, percent, pace, time to reset. "✕" marks a
// reset that has already passed, so the number is a cached one.
function LimitCell({ w, nowMs }: { w: LimitWindow; nowMs: number }) {
  const color = meterColor(w.percent);
  const ms = resetMs(w, nowMs);
  const p = pace(w, nowMs);
  const paceGlyph = p === "ahead" ? "▲" : p === "under" ? "▼" : " ";
  const paceColor = p === "ahead" ? (w.percent >= 0.7 ? theme.danger : theme.warn) : theme.muted;
  const reset = w.resetAt === "" ? "" : ms < 0 ? "✕" : formatDurationShort(ms);
  return (
    <Text>
      <Meter fraction={w.percent} color={color} />
      <Text color={color}> {formatPercent(w.percent).padStart(4)}</Text>
      <Text color={paceColor}>{paceGlyph}</Text>
      <Text color={ms < 0 && reset !== "" ? theme.muted : theme.dim}> {reset.padStart(4)}</Text>
    </Text>
  );
}

function BalanceCell({ p }: { p: Provider }) {
  const b = p.balance!;
  const left = b.funded > 0 ? b.remaining / b.funded : 1;
  return (
    <Text>
      <Meter fraction={left} color={meterColor(1 - left)} drain />
      <Text color={meterColor(1 - left)}> ${b.remaining.toFixed(2)}</Text>
      <Text color={theme.dim}>{b.estimated ? " ~" : ""}</Text>
    </Text>
  );
}

function Empty() {
  return (
    <Text color={theme.muted}>
      {" ".repeat(METER_W + 1)}·{" ".repeat(LIMIT_W - METER_W - 2)}
    </Text>
  );
}

function Spark({ p }: { p: Provider }) {
  const accent = accentFor(p.id);
  return (
    <Text>
      {sparkline(p.recentDays, SPARK_W).map((c, i) => (
        <Text key={i} color={c.zero ? theme.track : accent}>
          {c.glyph}
        </Text>
      ))}
    </Text>
  );
}

// The plan column is eight cells wide; a problem replaces the plan there.
function shortStatus(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("expired")) return "expired";
  if (t.includes("auth")) return "no auth";
  if (t.includes("unavailable") || t.includes("reach")) return "offline";
  return text.slice(0, PLAN_W);
}

const dotColor: Record<ReturnType<typeof health>, string> = {
  live: theme.ok,
  stale: theme.warn,
  alarm: theme.danger,
};

export function Table({ providers, layout, nowMs, selected }: Props) {
  const rule = "─".repeat(Math.max(10, layout.width));
  const todayTotal = providers.reduce((s, p) => s + p.todayTotalTokens, 0);
  const weekSum = providers.reduce((s, p) => s + weekTotal(p), 0);

  // In the one-limit tier each row shows its own binding window, so the
  // header can only say "Limit".
  const limitHeaders = layout.tier === "oneLimit" ? ["Limit"] : layout.windows;

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={layout.nameW + 1} flexShrink={0}>
          <Text color={theme.dim}> ACCOUNT</Text>
        </Box>
        {layout.showPlan && <Header text="Plan" width={PLAN_W} />}
        {limitHeaders.map((t) => (
          <Header key={t} text={t} width={layout.tier === "oneLimit" ? TITLE_W + 1 + LIMIT_W : LIMIT_W} />
        ))}
        <Header text="Today" width={TODAY_W} align="right" />
        <Header text="7 days" width={(layout.showSpark ? SPARK_W + 1 : 0) + TOTAL_W} align="right" />
      </Box>
      <Text color={theme.border}>{rule}</Text>
      {providers.map((p, i) => {
        const active = selected === i;
        const windows = limitWindows(p);
        const h = health(p);
        const cells =
          layout.tier === "oneLimit"
            ? [bindingWindow(p)]
            : layout.windows.map((title) => windows.find((w) => w.title === title) ?? null);
        let balanceShown = false;
        return (
          <Box key={p.id}>
            <Box width={layout.nameW + 1} flexShrink={0}>
              <Text color={dotColor[h]}>{active ? "▸" : " "}</Text>
              <Text color={dotColor[h]}>● </Text>
              <Text bold={active} color={active ? theme.fg : undefined} wrap="truncate">
                {p.name}
              </Text>
            </Box>
            {layout.showPlan && (
              <Cell width={PLAN_W}>
                <Text color={h === "stale" ? theme.warn : theme.dim} wrap="truncate">
                  {h === "stale" && p.usageStatusText ? shortStatus(p.usageStatusText) : p.tierLabel || heroMeta(p)}
                </Text>
              </Cell>
            )}
            {cells.map((w, ci) => {
              let body: ReactNode;
              if (w) {
                body =
                  layout.tier === "oneLimit" ? (
                    <Text>
                      <Text color={theme.dim}>{(w.title.split(" ")[0] ?? w.title).slice(0, TITLE_W).padEnd(TITLE_W)} </Text>
                      <LimitCell w={w} nowMs={nowMs} />
                    </Text>
                  ) : (
                    <LimitCell w={w} nowMs={nowMs} />
                  );
              } else if (p.balance && !balanceShown) {
                balanceShown = true;
                body = <BalanceCell p={p} />;
              } else {
                body = <Empty />;
              }
              return (
                <Cell key={ci} width={layout.tier === "oneLimit" ? TITLE_W + 1 + LIMIT_W : LIMIT_W}>
                  {body}
                </Cell>
              );
            })}
            <Cell width={TODAY_W} align="right">
              <Text color={p.todayTotalTokens > 0 ? theme.fg : theme.muted}>{formatTokenCount(p.todayTotalTokens)}</Text>
            </Cell>
            {layout.showSpark && (
              <Cell width={SPARK_W}>
                <Spark p={p} />
              </Cell>
            )}
            <Box width={TOTAL_W} marginLeft={layout.showSpark ? 1 : GAP} justifyContent="flex-end" flexShrink={0}>
              <Text color={theme.dim}>{formatTokenCount(weekTotal(p))}</Text>
            </Box>
          </Box>
        );
      })}
      <Text color={theme.border}>{rule}</Text>
      {providers.length > 1 && (
        <Box>
          <Box width={layout.nameW + 1} flexShrink={0}>
            <Text color={theme.dim}>   ALL</Text>
          </Box>
          {layout.showPlan && <Cell width={PLAN_W}>{null}</Cell>}
          {limitHeaders.map((t) => (
            <Cell key={t} width={layout.tier === "oneLimit" ? TITLE_W + 1 + LIMIT_W : LIMIT_W}>
              {null}
            </Cell>
          ))}
          <Cell width={TODAY_W} align="right">
            <Text bold>{formatTokenCount(todayTotal)}</Text>
          </Cell>
          {layout.showSpark && <Cell width={SPARK_W}>{null}</Cell>}
          <Box width={TOTAL_W} marginLeft={layout.showSpark ? 1 : GAP} justifyContent="flex-end" flexShrink={0}>
            <Text bold>{formatTokenCount(weekSum)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
