// Small JSON caches under ~/.cache/agentmeter. Written through a temp file
// and a rename so a reader never sees a half-written file.

import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// Resolved per call so a test can point it at a scratch directory.
export function cacheDir(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "agentmeter");
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return (await file.json()) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await Bun.write(tmp, JSON.stringify(value));
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export function shortHash(text: string): string {
  return new Bun.CryptoHasher("sha1").update(text).digest("hex").slice(0, 16);
}
