# agentmeter

Claude Code, Codex and Fireworks usage, limits and pace in the terminal.
One row per signed-in account: each rate-limit window as a meter with
percent used, pace (▲ outrunning the window, ▼ under it) and time to reset,
tokens today, and a sparkline of the last seven days. Select a row for the
reset times of every window, the day-by-day and the per-model breakdown.
Built with Bun and Ink.

It needs nothing but Claude Code. Transcripts under `~/.claude/projects`
(or `$CLAUDE_CONFIG_DIR`) give tokens by day and by model; the saved sign-in
gives the plan and the live rate limits from Anthropic's usage endpoint.
Every `~/.claude-<name>` directory with its own sign-in is a second account
and gets its own row. Scans are incremental, so a large history costs a
directory walk after the first run.

Codex and Fireworks rows appear when a record directory provides them:
one JSON file per agent under `~/.local/state/agentmeter/usage/`, or any
directory passed with `--dir`.

## Install

```
curl -fsSL https://joelzamboni.github.io/agentmeter/install.sh | sh
```

That drops the binary for your OS and CPU into `~/.local/bin` after
verifying its checksum. Then run `agentmeter`. Later, `agentmeter update` fetches the newest
release over the running binary; `agentmeter update --check` only reports.
Prebuilt binaries: Linux x64 and arm64, macOS arm64 and x64.

## Develop

```
bun install
bun start              # live panel
bun run once           # the table once, for scripts
bun src/cli.tsx --compact   # one line for a status bar
bun run build          # dist/agentmeter single binary
bun run install        # build and copy to ~/.local/bin
```

See `agentmeter --help` for flags and keys.

## Release

```
bun run release 0.2.0
```

Bumps `package.json`, commits, tags `v0.2.0` and pushes. The Release
workflow builds every target, attaches the binaries and checksums to a
GitHub release, and the install script and `agentmeter update` pick it up.
