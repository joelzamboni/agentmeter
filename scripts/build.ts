// Compiles src/cli.tsx into a single binary.
//
//   bun scripts/build.ts                      host target → dist/agentmeter
//   bun scripts/build.ts --target bun-linux-arm64 --outfile dist/agentmeter-linux-arm64
//
// Ink's optional React DevTools bridge imports `react-devtools-core`, which
// is not installed and never wanted in a binary, so the bundler is handed an
// empty module for it. The version comes from package.json.

import type { BunPlugin } from "bun";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = opt("--target");
const outfile = opt("--outfile") ?? "dist/agentmeter";
const version = (await Bun.file("package.json").json()).version as string;

const stubDevtools: BunPlugin = {
  name: "stub-react-devtools-core",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: ["src/cli.tsx"],
  minify: true,
  plugins: [stubDevtools],
  define: { "process.env.AGENTMETER_VERSION": JSON.stringify(version) },
  compile: target ? { target: target as any, outfile } : { outfile },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${outfile} (${version}${target ? ", " + target : ""})`);
