// bun run release 0.2.0 — bump package.json, commit, tag v0.2.0, push.
// The tag triggers .github/workflows/release.yml, which builds and publishes.

import { $ } from "bun";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: bun run release X.Y.Z");
  process.exit(2);
}

const dirty = (await $`git status --porcelain`.text()).trim();
if (dirty) {
  console.error("working tree is not clean; commit or stash first");
  process.exit(1);
}

const pkg = await Bun.file("package.json").json();
if (pkg.version !== version) {
  pkg.version = version;
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  await $`git add package.json`;
  await $`git commit -q -m ${"Release " + version}`;
}
await $`git tag -a ${"v" + version} -m ${"agentmeter " + version}`;
await $`git push origin main ${"v" + version}`;
console.log(`pushed v${version}; the Release workflow will publish the binaries`);
