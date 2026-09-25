import { resolve, join } from "node:path";
import { createCore } from "./server";
type CoreParentPort = { postMessage(value: unknown): void; on(event: "message", listener: (event: { data: unknown }) => void): void };
const parentPort = (process as NodeJS.Process & { parentPort?: CoreParentPort }).parentPort;
const core = createCore(
  process.env.AIREADER_DATA ??
    join(process.env.LOCALAPPDATA ?? resolve(".local"), "AIReader"),
  process.env.AIREADER_WEB ?? resolve("dist/web"),
);
core.server.listen(
  Number(process.env.AIREADER_PORT ?? 43120),
  "127.0.0.1",
  () => {
    const a = core.server.address();
    if (typeof a === "object" && a) {
      const message = { port: a.port };
      parentPort?.postMessage(message);
      process.send?.(message);
      console.log(`AIReader Core: http://127.0.0.1:${a.port}`);
    }
  },
);
let stopping = false;
parentPort?.on("message", ({ data: value }) => {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "shutdown" || stopping) return;
  const requestId = (value as { requestId?: unknown }).requestId;
  if (typeof requestId !== "string") return;
  stopping = true;
  void core.shutdown().then(() => {
    parentPort.postMessage({ type: "shutdown-complete", requestId });
    setTimeout(() => process.exit(0), 100);
  }).catch((error: unknown) => {
    stopping = false;
    parentPort.postMessage({ type: "shutdown-failed", requestId, error: String(error) });
  });
});
process.on("SIGTERM", () => {
  core.close();
  process.exit(0);
});
