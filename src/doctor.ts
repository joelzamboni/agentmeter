// `agentmeter doctor`: where it looked, what it found, and whether the
// limits probe answers. Prints no secrets.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { discoverAccounts, oauthLogin, probeLimits, scanTranscripts } from "./collect/claude.ts";
import { cacheDir } from "./collect/cache.ts";
import { EXTRA_RECORD_DIRS } from "./records.ts";
import { VERSION } from "./version.ts";

async function count(dir: string, suffix: string): Promise<number> {
  let n = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) n += await count(join(dir, e.name), suffix);
    else if (e.name.endsWith(suffix)) n++;
  }
  return n;
}

export async function doctor(write: (line: string) => void): Promise<number> {
  write(`agentmeter ${VERSION} on ${process.platform}/${process.arch}`);
  write(`cache: ${cacheDir()}`);
  write(`extra records: ${EXTRA_RECORD_DIRS.join(", ")}`);
  const accounts = await discoverAccounts();
  let problems = 0;
  for (const a of accounts) {
    write("");
    write(`${a.id}  ${a.dir}${a.isDefault ? "  (default)" : ""}`);
    const files = await count(join(a.dir, "projects"), ".jsonl");
    const stats = await scanTranscripts(a.dir);
    write(`  transcripts: ${files} files, ${stats.totalPrompts} assistant messages, ${stats.activeDays} active days`);
    const login = await oauthLogin(a.dir, a.isDefault);
    if (login.source === "none") {
      write(`  sign-in: not found (${join(a.dir, ".credentials.json")}${process.platform === "darwin" && a.isDefault ? ", Keychain 'Claude Code-credentials'" : ""})`);
      problems++;
      continue;
    }
    const expires = login.expiresAt ? new Date(login.expiresAt).toISOString() : "unknown";
    const expired = login.expiresAt > 0 && login.expiresAt <= Date.now();
    write(`  sign-in: ${login.source}, plan ${login.plan || "unknown"}, token ${login.accessToken ? "present" : "missing"}, expires ${expires}${expired ? " (EXPIRED)" : ""}`);
    if (!login.accessToken || expired) {
      problems++;
      continue;
    }
    const probe = await probeLimits(login.accessToken);
    if (probe.ok) {
      write(`  limits: ${probe.limits.map((l) => `${l.title ?? l.label} ${Math.round(l.percent * 100)}%`).join(", ")}`);
    } else {
      write(`  limits: ${probe.helpText}`);
      problems++;
    }
  }
  write("");
  write(problems === 0 ? "All good." : `${problems} problem(s).`);
  return problems === 0 ? 0 : 1;
}
