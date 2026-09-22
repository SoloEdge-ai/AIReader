import { app, BrowserWindow, dialog, utilityProcess, shell } from "electron";
import { join } from "node:path";
import { release } from "node:os";
let core: Electron.UtilityProcess | undefined;
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
  core.on("message", (message: { port: number }) => {
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
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (["https:", "http:", "mailto:"].includes(target.protocol))
          void shell.openExternal(url);
      } catch {}
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`http://127.0.0.1:${message.port}/`))
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
    void window.loadURL(`http://127.0.0.1:${message.port}`);
  });
  core.on("exit", () => {
    if (!app.isPackaged) console.log("Core stopped");
  });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => core?.kill());
