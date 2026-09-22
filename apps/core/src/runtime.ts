import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import * as tar from "tar";
import type { AiRuntimeStatus } from "../../../packages/protocol/src";
export const runtimeManifest = {
  version: "0.155.1",
  url: "https://registry.npmjs.org/@openai/codex/-/codex-0.155.1-win32-x64.tgz",
  integrity:
    "MO+cCZrgU0Ec7lJP/5NsTe5obJ9/qtRMkQUK0jYWTY1omxLA3lp5IOD2IAmsejlEJB931XRo51LZ7hl178CDjA==",
  binary: "vendor/x86_64-pc-windows-msvc/bin/codex.exe",
};
async function hashFile(file: string, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(algorithm === "sha512" ? "base64" : "hex");
}
export class RuntimeManager {
  state: AiRuntimeStatus;
  private control?: AbortController;
  private operation?: Promise<void>;
  readonly root: string;
  constructor(
    directory: string,
    readonly emit: (status: AiRuntimeStatus) => void,
    readonly manifest = runtimeManifest,
  ) {
    this.root = resolve(directory, "runtimes", "codex");
    this.state = { status: "missing", version: manifest.version };
  }
  private update(value: Partial<AiRuntimeStatus>) {
    this.state = { ...this.state, ...value };
    this.emit(this.state);
  }
  async executable() {
    const target = join(this.root, this.manifest.version),
      record = JSON.parse(
        await readFile(join(target, "verified.json"), "utf8").catch(() => {
          throw new Error("请先准备 AI 组件");
        }),
      );
    const binary = join(target, this.manifest.binary);
    if (
      record.integrity !== this.manifest.integrity ||
      record.binaryHash !== (await hashFile(binary))
    )
      throw new Error("AI 组件校验失败，请重新准备组件");
    return binary;
  }
  async inspect() {
    try {
      await this.executable();
      this.update({ status: "ready", error: undefined });
    } catch {
      this.update({ status: "missing" });
    }
    return this.state;
  }
  prepare() {
    if (this.operation) return this.operation;
    this.control = new AbortController();
    this.operation = this.install(this.control.signal)
      .catch((error) => {
        this.update({
          status: this.control?.signal.aborted ? "missing" : "error",
          error: this.control?.signal.aborted
            ? undefined
            : String(error.message ?? error),
        });
      })
      .finally(() => {
        this.control = undefined;
        this.operation = undefined;
      });
    return this.operation;
  }
  cancel() {
    this.control?.abort();
    return this.operation ?? Promise.resolve();
  }
  private async install(signal: AbortSignal) {
    await mkdir(this.root, { recursive: true });
    const stage = join(this.root, "prepare-" + randomUUID()),
      archive = join(stage, "download.tgz"),
      extracted = join(stage, "content");
    await mkdir(extracted, { recursive: true });
    this.update({
      status: "downloading",
      received: 0,
      total: undefined,
      error: undefined,
    });
    try {
      const response = await fetch(this.manifest.url, {
        signal,
        redirect: "error",
      });
      if (!response.ok || !response.body)
        throw new Error(`组件下载失败（${response.status}）`);
      const length =
        Number(response.headers.get("content-length")) || undefined;
      if (length && length > 256 * 1024 * 1024)
        throw new Error("组件超过大小限制");
      const file = await open(archive, "wx");
      const hash = createHash("sha512");
      let received = 0,
        last = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          signal.throwIfAborted();
          received += chunk.length;
          if (received > 256 * 1024 * 1024) throw new Error("组件超过大小限制");
          hash.update(chunk);
          await file.writeFile(chunk);
          if (Date.now() - last > 150) {
            this.update({ received, total: length });
            last = Date.now();
          }
        }
      } finally {
        reader.releaseLock();
        await file.close();
      }
      this.update({ status: "verifying", received, total: length });
      if (hash.digest("base64") !== this.manifest.integrity)
        throw new Error("组件完整性校验失败，未安装任何可执行文件");
      let unpacked = 0,
        unsafe = false;
      await tar.t({
        file: archive,
        strict: true,
        onReadEntry: (entry) => {
          const name = entry.path.replaceAll("\\", "/");
          if (
            !name.startsWith("package/") ||
            name.split("/").includes("..") ||
            name.includes(":") ||
            !["File", "Directory"].includes(entry.type)
          )
            unsafe = true;
          unpacked += entry.size;
          if (unpacked > 700 * 1024 * 1024) unsafe = true;
        },
      });
      if (unsafe) throw new Error("组件包含不安全的归档项或解压大小超限");
      signal.throwIfAborted();
      await tar.x({
        file: archive,
        cwd: extracted,
        strip: 1,
        strict: true,
        preservePaths: false,
        filter: (path) =>
          path.startsWith("package/vendor/") ||
          path === "package/package.json" ||
          path.startsWith("package/LICENSE"),
      });
      signal.throwIfAborted();
      const binary = join(extracted, this.manifest.binary);
      if (!(await stat(binary)).isFile()) throw new Error("组件缺少可执行文件");
      await writeFile(
        join(extracted, "verified.json"),
        JSON.stringify({
          integrity: this.manifest.integrity,
          binaryHash: await hashFile(binary),
        }),
      );
      const target = join(this.root, this.manifest.version),
        previous = target + "-previous-" + Date.now();
      let moved = false;
      try {
        await rename(target, previous);
        moved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await rename(extracted, target);
      } catch (error) {
        if (moved) await rename(previous, target);
        throw error;
      }
      this.update({ status: "ready", error: undefined });
    } finally {
      await rm(stage, {
        recursive: true,
        force: true,
        maxRetries: 4,
        retryDelay: 100,
      });
    }
  }
}
