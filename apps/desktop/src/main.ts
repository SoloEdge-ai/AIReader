import { app, BrowserWindow, dialog, utilityProcess, shell } from "electron";
import { join } from "node:path";
import { release } from "node:os";
import { randomUUID } from "node:crypto";
let core: Electron.UtilityProcess | undefined;
function withDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`等待超过 ${milliseconds / 1000} 秒`)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function stopCore(onLateComplete: () => void): Promise<void> {
  const child = core;
  if (!child) return Promise.reject(new Error("Core 尚未就绪"));
  const requestId = randomUUID();
  return new Promise<void>((resolve, reject) => {
    let timedOut = false;
    let finished = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Core 停止超过 15 秒，仍在等待确认"));
    }, 15000);
    const onMessage = (value: unknown) => {
      if (!value || typeof value !== "object" || (value as { requestId?: unknown }).requestId !== requestId) return;
      const message = value as { type?: string; error?: string };
      if (message.type === "shutdown-complete") finish();
      else if (message.type === "shutdown-failed") finish(new Error(message.error ?? "Core 停止失败"));
    };
    const onExit = () => finish(new Error("Core 未确认关闭便退出"));
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child!.off("message", onMessage);
      child!.off("exit", onExit);
      if (error) { if (!timedOut) reject(error); }
      else {
        core = undefined;
        if (timedOut) onLateComplete();
        else resolve();
      }
    }
    child.on("message", onMessage);
    child.once("exit", onExit);
    try { child.postMessage({ type: "shutdown", requestId }); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
app.setPath(
  "userData",
  process.env.AIREADER_DATA ??
    join(process.env.LOCALAPPDATA ?? app.getPath("appData"), "AIReader"),
);
app.whenReady().then(() => {
  if (
    !process.env.AIREADER_CI &&
    (process.platform !== "win32" ||
      process.arch !== "x64" ||
      Number(release().split(".")[2]) < 22000)
  ) {
    dialog.showErrorBox("系统不受支持", "AIReader 需要 Windows 11 x64。");
    app.quit();
    return;
  }
  core = utilityProcess.fork(join(__dirname, "../core/main.cjs"), [], {
    env: {
      ...process.env,
      AIREADER_PORT: "0",
      AIREADER_WEB: join(__dirname, "../web"),
      AIREADER_WORKER: join(__dirname, "../core/pdf-worker.mjs"),
      AIREADER_DATA: app.getPath("userData"),
    },
    serviceName: "AIReader Core",
  });
  core.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || typeof (message as { port?: unknown }).port !== "number") return;
    const port = (message as { port: number }).port;
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 960,
      minHeight: 640,
      title: "AIReader",
      icon: join(__dirname, "app.ico"),
      backgroundColor: "#f5f3ee",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let checkingClose = false;
    let coreStopUncertain = false;
    window.on("close", (event) => {
      event.preventDefault();
      if (checkingClose || coreStopUncertain) return;
      checkingClose = true;
      let stoppingCore = false;
      void withDeadline(window.webContents.executeJavaScript(`(async () => {
        if (typeof window.aiReaderFlushBeforeClose !== "function") throw new Error("未找到保存入口");
        const saved = await window.aiReaderFlushBeforeClose();
        if (typeof saved !== "boolean") throw new Error("保存结果无效");
        return saved;
      })()`), 15000)
        .then(async (saved: boolean) => {
          if (!saved || window.isDestroyed()) return;
          stoppingCore = true;
          await stopCore(() => { if (!window.isDestroyed()) window.destroy(); });
          // The drafts were verified before Core closed. A second cancelable
          // beforeunload would strand an editor with no database behind it.
          if (!window.isDestroyed()) window.destroy();
        })
        .catch((error: unknown) => {
          if (!window.isDestroyed()) {
            if (!stoppingCore)
              void window.webContents.executeJavaScript("document.body.inert = false").catch(() => {});
            else coreStopUncertain = true;
            console.error("AIReader close handshake failed:", error);
            void dialog.showMessageBox(window, {
            type: "warning", title: "无法安全退出",
            message: stoppingCore
              ? "草稿已保存，但 Core 停止状态未确认。为避免继续写入，窗口保持锁定。"
              : "保存未得到确认，窗口保持打开。",
            detail: String(error),
            buttons: stoppingCore ? ["继续等待", "退出应用（停止未确认）"] : ["返回编辑"],
            defaultId: 0, cancelId: 0,
            }).then(({ response }) => {
              if (stoppingCore && response === 1 && !window.isDestroyed()) window.destroy();
            }).catch(() => {});
          }
        }).finally(() => { checkingClose = false; });
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (["https:", "http:", "mailto:"].includes(target.protocol))
          void shell.openExternal(url);
      } catch {}
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`http://127.0.0.1:${port}/`))
        event.preventDefault();
    });
    window.webContents.on("will-prevent-unload", (event) => {
      const discard = dialog.showMessageBoxSync(window, {
        type: "warning",
        title: "笔记尚未保存",
        message: "还有未保存的笔记草稿。",
        detail: "返回编辑可以重试保存；放弃草稿将丢失尚未保存的修改。",
        buttons: ["返回编辑", "放弃草稿并退出"],
        defaultId: 0,
        cancelId: 0,
      });
      if (discard === 1) event.preventDefault();
    });
    void window.loadURL(`http://127.0.0.1:${port}`);
  });
  core.on("exit", () => {
    if (!app.isPackaged) console.log("Core stopped");
  });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => core?.kill());
