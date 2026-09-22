import {
  mkdir,
  writeFile,
  readdir,
  readFile,
  lstat,
  realpath,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { ChatTurn, ToolRun } from "../../../packages/protocol/src";
import { Library } from "./library";
import { CodexAdapter } from "./codex";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export class BookTools {
  private closed = false;
  private verified = new Map<string, { available: boolean; reason: string }>();
  private active = new Map<string, string>();
  constructor(
    readonly library: Library,
    readonly codex: CodexAdapter,
  ) {}
  workspace(bookId: string) {
    this.library.book(bookId);
    return join(this.library.directory, "workspaces", bookId);
  }
  status(bookId: string) {
    return (
      this.verified.get(bookId) ?? {
        available: false,
        reason: "尚未验证 Windows 沙盒，请先检查工具环境。",
      }
    );
  }
  async verify(bookId: string) {
    const cwd = this.workspace(bookId);
    await mkdir(cwd, { recursive: true });
    const sentinel = join(
      this.library.directory,
      "sandbox-sentinel-" + randomUUID() + ".txt",
    );
    await writeFile(sentinel, "AIReader isolation probe");
    const listener = createServer((socket) => socket.end());
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    let result = { available: false, reason: "沙盒验证失败" };
    try {
      const port = typeof address === "object" && address ? address.port : 0;
      const script = `$ErrorActionPreference='Stop'; Set-Content -LiteralPath './probe.txt' -Value 'ok'; if ((Get-Content -LiteralPath './probe.txt') -ne 'ok') { exit 11 }; try { Get-Content -LiteralPath ${quote(sentinel)} -ErrorAction Stop | Out-Null; exit 12 } catch {}; try { Set-Content -LiteralPath ${quote(sentinel)} -Value 'changed' -ErrorAction Stop; exit 13 } catch {}; try { $client=New-Object System.Net.Sockets.TcpClient; $task=$client.ConnectAsync('127.0.0.1',${port}); if ($task.Wait(2000) -and $client.Connected) { $client.Dispose(); exit 14 } } catch {}; Write-Output 'AIREADER_SANDBOX_OK'`;
      const output = await this.codex.command(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        cwd,
        randomUUID(),
      );
      if (
        output.exitCode === 0 &&
        String(output.stdout).includes("AIREADER_SANDBOX_OK") &&
        (await readFile(sentinel, "utf8")) === "AIReader isolation probe"
      )
        result = {
          available: true,
          reason: "本书工作区读写、外部文件拒绝和网络拒绝均已验证。",
        };
      else
        result = {
          available: false,
          reason: `Windows 沙盒未通过隔离测试（退出码 ${output.exitCode ?? "未知"}），编程工具已禁用。阅读问答不受影响。`,
        };
    } catch (error) {
      result = {
        available: false,
        reason:
          "无法验证 Windows 沙盒：" +
          (error instanceof Error ? error.message : String(error)).slice(
            0,
            300,
          ),
      };
    } finally {
      listener.close();
    }
    this.verified.set(bookId, result);
    return result;
  }
  async run(bookId: string, turnId: string, script: string) {
    if (!this.status(bookId).available)
      throw new Error(this.status(bookId).reason);
    if (this.active.has(turnId)) throw new Error("当前已有工具正在运行");
    const turn = this.library.store.get<ChatTurn>("turn", turnId);
    if (!turn || turn.bookId !== bookId) throw new Error("会话与书籍不匹配");
    if (turn.tools.length >= 8) throw new Error("本轮已达到 8 次工具调用上限");
    const run: ToolRun = {
      id: randomUUID(),
      bookId,
      turnId,
      command: script,
      output: "",
      status: "running",
    };
    turn.tools.push(run);
    this.library.store.put("turn", turnId, bookId, turn);
    this.active.set(turnId, run.id);
    try {
      const cwd = this.workspace(bookId);
      await writeFile(
        join(cwd, "evidence.txt"),
        turn.context.evidence.map((p) => `[${p.id}]\n${p.text}`).join("\n"),
      );
      const result = await this.codex.command(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        cwd,
        run.id,
      );
      run.output = (
        String(result.stdout ?? "") +
        "\n" +
        String(result.stderr ?? "")
      ).slice(0, 8000);
      run.status = result.exitCode === 0 ? "complete" : "failed";
      run.files = await this.files(bookId);
    } catch (error) {
      run.status = "failed";
      run.output = String(error).slice(0, 8000);
    } finally {
      this.active.delete(turnId);
      if (!this.closed) {
        this.library.store.put("turn", turnId, bookId, turn);
        this.library.emit({ type: "turn", bookId, taskId: turnId, data: turn });
      }
    }
    return run;
  }
  async files(bookId: string) {
    const root = this.workspace(bookId);
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.isSymbolicLink())
      .map((e) => e.name)
      .slice(0, 100);
  }
  async file(bookId: string, name: string) {
    const root = await realpath(this.workspace(bookId));
    const path = resolve(root, name);
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("非法文件路径");
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("只允许下载工作区内的普通文件");
    const actual = await realpath(path);
    if (relative(root, actual).startsWith(".."))
      throw new Error("不允许访问工作区以外的文件");
    return path;
  }
  async cancel(turnId: string) {
    const processId = this.active.get(turnId);
    if (processId) await this.codex.stopCommand(processId);
  }
  close() {
    this.closed = true;
    this.stopAll();
  }
  stopAll() {
    for (const processId of this.active.values())
      void this.codex.stopCommand(processId);
  }
}
