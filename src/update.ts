// `agentmeter update`: fetch the latest GitHub release, verify the checksum,
// and swap the running binary in place. Same source of truth as install.sh.

import { chmod, rename, unlink, access, constants } from "node:fs/promises";
import { dirname, join } from "node:path";
import { REPO, VERSION } from "./version.ts";

type Release = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

export function assetName(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "";
  if (!os || !arch) throw new Error(`no prebuilt binary for ${process.platform}/${process.arch}`);
  return `agentmeter-${os}-${arch}`;
}

export async function latestRelease(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `agentmeter/${VERSION}` },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  return (await res.json()) as Release;
}

const strip = (v: string) => v.replace(/^v/, "");

export function isNewer(latest: string, current: string): boolean {
  if (current === "dev") return true;
  const a = strip(latest).split(".").map(Number);
  const b = strip(current).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers: { "User-Agent": `agentmeter/${VERSION}` } });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  return res.arrayBuffer();
}

export async function checkForUpdate(): Promise<{ latest: string; newer: boolean }> {
  const rel = await latestRelease();
  return { latest: strip(rel.tag_name), newer: isNewer(rel.tag_name, VERSION) };
}

export async function selfUpdate(log: (line: string) => void): Promise<boolean> {
  const rel = await latestRelease();
  const latest = strip(rel.tag_name);
  if (!isNewer(rel.tag_name, VERSION)) {
    log(`agentmeter ${VERSION} is up to date.`);
    return false;
  }
  const name = assetName();
  const asset = rel.assets.find((a) => a.name === name);
  const sum = rel.assets.find((a) => a.name === `${name}.sha256`);
  if (!asset || !sum) throw new Error(`release ${rel.tag_name} has no ${name}`);

  const exe = process.execPath;
  const dir = dirname(exe);
  try {
    await access(dir, constants.W_OK);
  } catch {
    throw new Error(`${dir} is not writable; reinstall with:\n  curl -fsSL https://joelzamboni.github.io/agentmeter/install.sh | sh`);
  }

  log(`updating ${VERSION} → ${latest} (${name})…`);
  const [bytes, sumText] = await Promise.all([download(asset.browser_download_url), download(sum.browser_download_url)]);
  const expected = new TextDecoder().decode(sumText).trim().split(/\s+/)[0]?.toLowerCase();
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (!expected || expected !== actual) throw new Error("checksum mismatch; the download was not installed");

  const tmp = join(dir, `.agentmeter.${process.pid}.tmp`);
  try {
    await Bun.write(tmp, bytes);
    await chmod(tmp, 0o755);
    await rename(tmp, exe);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  log(`agentmeter ${latest} installed at ${exe}`);
  return true;
}
