import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir } from "node:fs/promises";
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
  packages: "external",
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
await viteBuild({
  root: "apps/web",
  base: "./",
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
