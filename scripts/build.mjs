import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, copyFile, readFile } from "node:fs/promises";
// The Markdown plugins are ESM-only. Bundle this graph so the emitted CJS Core
// does not receive namespace objects from require() in place of plugin functions.
const bundledPackages = new Set([
  "unified",
  "remark-parse",
  "remark-gfm",
  "remark-math",
  // Keep page-bound validation self-contained in the packaged Core.
  "pdf-lib",
]);
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("dist/core", { recursive: true });
await build({
  entryPoints: ["apps/core/src/pdf-worker.ts"],
  outfile: "dist/core/pdf-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
await build({
  entryPoints: ["apps/core/src/main.ts"],
  outfile: "dist/core/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: Object.keys(manifest.dependencies).filter(
    (name) => !bundledPackages.has(name),
  ),
  sourcemap: true,
});
await build({
  entryPoints: ["apps/desktop/src/main.ts"],
  outfile: "dist/desktop/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await copyFile("assets/app.ico", "dist/desktop/app.ico");
await viteBuild({
  root: "apps/web",
  base: "./",
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
