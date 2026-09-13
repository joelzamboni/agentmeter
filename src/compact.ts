// One line for status bars: every account's window percentages in table
// order, "!" on an account whose binding window is at 90% or more.

import type { Provider } from "./records.ts";
import { formatPercent, limitWindows, providerAlarming, shortName } from "./format.ts";
import { windowOrder } from "./columns.ts";

export function compactLine(providers: Provider[]): string {
  const order = windowOrder(providers);
  return providers
    .map((p) => {
      const windows = limitWindows(p);
      const percents = order
        .map((title) => windows.find((w) => w.title === title))
        .filter((w) => w !== undefined)
        .map((w) => formatPercent(w.percent));
      const body = percents.length > 0 ? percents.join("/") : p.balance ? `$${p.balance.remaining.toFixed(2)}` : "–";
      return `${shortName(p)} ${body}${providerAlarming(p) ? "!" : ""}`;
    })
    .join(" · ");
}
