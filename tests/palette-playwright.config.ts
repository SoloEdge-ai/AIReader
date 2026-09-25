import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
    testMatch: ["palette-collapse.spec.ts", "workspace-menu.spec.ts", "note-editing.spec.ts"],
  workers: 1,
  use: { browserName: "chromium", channel: "chrome", headless: true },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command:
      "pnpm exec vite apps/web --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173/tests/palette.html",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
