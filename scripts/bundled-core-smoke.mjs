// Exercise the emitted CommonJS entry point, not the TypeScript test loader.
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "aireader-bundled-core-"));
const child = fork(resolve("dist/core/main.cjs"), [], {
  env: { ...process.env, AIREADER_DATA: directory, AIREADER_PORT: "0" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  windowsHide: true,
});
let diagnostic = "";
child.stderr.on("data", (chunk) => {
  diagnostic = (diagnostic + chunk).slice(-6000);
});
const exited = new Promise((done) => child.once("exit", done));
try {
  const port = await new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`Core startup timeout: ${diagnostic}`)),
      10000,
    );
    child.once("message", (message) => {
      clearTimeout(timer);
      done(message.port);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`Core exited (${code}): ${diagnostic}`));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const session = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: origin },
  });
  assert.equal(session.status, 200);
  const books = await fetch(`${origin}/api/books`, {
    headers: { Cookie: session.headers.get("set-cookie").split(";")[0] },
  });
  assert.equal(books.status, 200);
  assert.deepEqual(await books.json(), []);
  console.log("Bundled Core startup and authenticated library HTTP passed.");
} finally {
  if (child.exitCode === null) child.kill();
  await exited;
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
