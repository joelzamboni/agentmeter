#!/usr/bin/env bun
import { render } from "ink";
import { App } from "./ui/App.tsx";
import { loadProviders } from "./records.ts";
import { compactLine } from "./compact.ts";
import { sortProviders } from "./ui/App.tsx";
import { VERSION } from "./version.ts";
import { checkForUpdate, selfUpdate } from "./update.ts";
import { doctor } from "./doctor.ts";

const HELP = `agentmeter ${VERSION} — Claude Code, Codex and Fireworks usage in the terminal

Reads Claude Code's own files (~/.claude, or $CLAUDE_CONFIG_DIR, plus every
~/.claude-<name> account) and Anthropic's usage endpoint, and shows one row
per signed-in account: each rate-limit window as a meter with percent used,
pace (▲ outrunning the window, ▼ under it) and time to reset, tokens today,
and the last seven days.

Usage:
  agentmeter              live table, updates as records change
  agentmeter --once       print the table once and exit
  agentmeter --compact    one line for status bars: "claude 1%/2% · webera 84%!"
  agentmeter --force      rescan every transcript and re-probe limits
  agentmeter --dir PATH   show JSON usage records from a directory instead
  agentmeter doctor       show what it finds: accounts, transcripts, sign-in, limits
  agentmeter version      print the version
  agentmeter update       install the latest release over this binary
  agentmeter update --check   only report whether a newer release exists

Keys (live table):
  j/k or ↑/↓   select account      1-9          jump to a row
  Enter / d    toggle detail       s            sort: limit, name, tokens
  r            refresh limits      R            force a full rescan
  q / Esc      quit
`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const command = args[0] && !args[0].startsWith("-") ? args[0] : "";

if (command === "version" || flag("--version") || flag("-v")) {
  process.stdout.write(`agentmeter ${VERSION}\n`);
  process.exit(0);
}

if (command === "doctor") {
  process.exit(await doctor((line) => process.stdout.write(line + "\n")));
}

if (command === "update") {
  try {
    if (flag("--check")) {
      const { latest, newer } = await checkForUpdate();
      process.stdout.write(newer ? `agentmeter ${latest} is available (you have ${VERSION})\n` : `agentmeter ${VERSION} is up to date.\n`);
      process.exit(newer ? 10 : 0);
    }
    await selfUpdate((line) => process.stdout.write(line + "\n"));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`agentmeter: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (command !== "") {
  process.stderr.write(`agentmeter: unknown command "${command}"\n${HELP}`);
  process.exit(2);
}

if (flag("--help") || flag("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const dirIndex = args.indexOf("--dir");
const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
const once = flag("--once") || flag("-1") || !process.stdout.isTTY;

if (flag("--compact")) {
  const list = sortProviders(await loadProviders({ dir, force: flag("--force") }), "name");
  process.stdout.write(compactLine(list) + "\n");
  process.exit(0);
}

const app = render(<App once={once} dir={dir} force={flag("--force")} />, { exitOnCtrlC: true });
await app.waitUntilExit();
