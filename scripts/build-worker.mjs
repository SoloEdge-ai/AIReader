import { build } from "esbuild";
await build({
  entryPoints: ["apps/core/src/pdf-worker.ts"],
  outfile: "dist/core/pdf-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
