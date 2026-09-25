import { useEffect, useRef } from "react";

type CloseAwareWindow = Window & { aiReaderFlushBeforeClose?: () => Promise<boolean> };

const SAVE_DEADLINE_MS = 12_000;

/** Owns the renderer half of desktop close: coalescing, input lock, and bounded save. */
export function useDesktopCloseHandshake(
  flushCurrentBook: () => Promise<boolean>,
  reportFailure: (message: string) => void,
): void {
  const latest = useRef({ flushCurrentBook, reportFailure });
  latest.current = { flushCurrentBook, reportFailure };
  const pending = useRef<Promise<boolean> | undefined>(undefined);

  useEffect(() => {
    const desktop = window as CloseAwareWindow;
    const onClose = (): Promise<boolean> => {
      if (pending.current) return pending.current;
      document.body.inert = true;
      const attempt = (async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const saved = await Promise.race([
            latest.current.flushCurrentBook(),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error("保存等待超过 12 秒，请检查 Core 后重试")),
                SAVE_DEADLINE_MS,
              );
            }),
          ]);
          if (!saved) throw new Error("仍有未保存的草稿");
          return true;
        } catch (cause) {
          document.body.inert = false;
          latest.current.reportFailure(`关闭前保存失败，窗口和草稿已保留：${String(cause)}`);
          return false;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      })();
      pending.current = attempt;
      void attempt.finally(() => {
        if (pending.current === attempt) pending.current = undefined;
      });
      return attempt;
    };
    desktop.aiReaderFlushBeforeClose = onClose;
    return () => {
      if (desktop.aiReaderFlushBeforeClose === onClose) delete desktop.aiReaderFlushBeforeClose;
    };
  }, []);
}
