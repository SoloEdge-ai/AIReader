import { resolve } from "node:path";
import { RuntimeManager } from "../apps/core/src/runtime";
import { CodexAdapter } from "../apps/core/src/codex";
const root = resolve(".local/runtime-smoke");
let last = "";
const runtime = new RuntimeManager(root, (status) => {
  if (status.status !== last) {
    last = status.status;
    console.log(status.status);
  }
});
await runtime.inspect();
if (runtime.state.status !== "ready") await runtime.prepare();
if (runtime.state.status !== "ready") throw new Error(runtime.state.error);
const adapter = new CodexAdapter(resolve(root, "control"), () =>
  runtime.executable(),
);
try {
  await adapter.connect();
  console.log(
    JSON.stringify({
      connected: adapter.info.connected,
      account: adapter.info.account,
      version: adapter.info.version,
    }),
  );
  if (adapter.info.account)
    throw new Error("Expected an isolated signed-out account");
} finally {
  await adapter.disconnect();
}
