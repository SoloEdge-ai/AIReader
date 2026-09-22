import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import type {
  AccountState,
  AiRuntimeStatus,
  ModelOption,
  ModelSelection,
} from "../../../packages/protocol/src";
import { api, post } from "./api";
type State = {
  account: AccountState;
  runtime: AiRuntimeStatus;
  models: ModelOption[];
  choice: ModelSelection | null;
  error: string;
  refresh: () => Promise<void>;
  choose: (value: ModelSelection) => Promise<void>;
  operate: (action: string) => Promise<void>;
};
const Context = createContext<State>(null!);
export const useAi = () => useContext(Context);
export function AiProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AccountState>({ connected: false }),
    [runtime, setRuntime] = useState<AiRuntimeStatus>({
      status: "missing",
      version: "0.155.1",
    });
  const [models, setModels] = useState<ModelOption[]>([]),
    [choice, setChoice] = useState<ModelSelection | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const [a, r, c] = await Promise.all([
      api<AccountState>("ai/status"),
      api<AiRuntimeStatus>("ai/runtime"),
      api<ModelSelection | null>("ai/selection"),
    ]);
    setAccount(a);
    setRuntime(r);
    setChoice(c);
    if (!a.account) setModels([]);
  }, []);
  useEffect(() => {
    let dead = false;
    let updating = false;
    const tick = async () => {
      if (updating || dead) return;
      updating = true;
      try {
        await refresh();
      } catch {
      } finally {
        updating = false;
      }
    };
    void post("session", {}).then(tick);
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [refresh]);
  const identity = account.account ? JSON.stringify(account.account) : "";
  useEffect(() => {
    let live = true;
    if (!identity || !account.connected) {
      setModels([]);
      return;
    }
    void api<ModelOption[]>("ai/models")
      .then(async (list) => {
        if (!live) return;
        setModels(list);
        const saved = await api<ModelSelection | null>("ai/selection");
        if (!live) return;
        if (saved) setChoice(saved);
        else {
          const first = list.find((m) => m.isDefault) ?? list[0];
          if (first) {
            const value = {
              model: first.model,
              effort: first.defaultReasoningEffort,
            };
            await post("ai/selection", value);
            if (live) setChoice(value);
          }
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [identity, account.connected]);
  async function choose(value: ModelSelection) {
    try {
      await post("ai/selection", value);
      setChoice(value);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function operate(action: string) {
    setError("");
    try {
      if (action === "login") {
        const result = await post<{ authUrl: string }>("ai/login", {});
        const url = new URL(result.authUrl);
        if (
          url.protocol !== "https:" ||
          !["auth.openai.com", "chatgpt.com"].includes(url.hostname)
        )
          throw new Error("登录链接未通过安全检查");
        window.open(url.href, "_blank", "noopener");
      } else await post("ai/" + action, {});
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Context.Provider
      value={{
        account,
        runtime,
        models,
        choice,
        error,
        refresh,
        choose,
        operate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function AccountControls() {
  const ai = useAi();
  const downloading = ["downloading", "verifying"].includes(ai.runtime.status);
  return (
    <section className="account-controls">
      <h3>ChatGPT 账号</h3>
      {ai.runtime.status !== "ready" ? (
        <>
          <p>
            首次使用需要下载 AI 组件，之后在浏览器中登录。阅读和笔记无需登录。
          </p>
          {downloading ? (
            <>
              <p>
                {ai.runtime.status === "verifying"
                  ? "正在校验组件…"
                  : `正在下载 ${Math.round((ai.runtime.received ?? 0) / 1048576)} MB${ai.runtime.total ? " / " + Math.round(ai.runtime.total / 1048576) + " MB" : ""}`}
              </p>
              <button onClick={() => void ai.operate("runtime/cancel")}>
                取消下载
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => void ai.operate("runtime")}
            >
              准备 AI 组件
            </button>
          )}
        </>
      ) : ai.account.account ? (
        <>
          <p>{ai.account.account.email ?? "已登录 ChatGPT"}</p>
          <p className="muted">{ai.account.account.planType ?? ""}</p>
          <button
            onClick={() => {
              if (confirm("退出将停止回答并暂停索引。书库和笔记会保留。"))
                void ai.operate("logout");
            }}
          >
            退出账号
          </button>
        </>
      ) : ai.account.login ? (
        <>
          <p>等待浏览器授权…</p>
          <button onClick={() => void ai.operate("login")}>
            重新打开浏览器
          </button>
          <button onClick={() => void ai.operate("login-cancel")}>
            取消登录
          </button>
        </>
      ) : (
        <>
          <p>
            AIReader 单独保存登录状态，不会使用或更改其他 Codex 客户端的账号。
          </p>
          <button className="primary" onClick={() => void ai.operate("login")}>
            登录 ChatGPT
          </button>
        </>
      )}
      {(ai.error || ai.runtime.error || ai.account.error) && (
        <p className="error">
          {ai.error || ai.runtime.error || ai.account.error}
        </p>
      )}
      <details>
        <summary>组件与隐私</summary>
        <p>
          Codex {ai.runtime.version} ·{" "}
          {ai.runtime.status === "ready" ? "已准备" : "尚未就绪"}
        </p>
        <p>
          问答按需发送相关原文。笔记和区域摘录不自动上传。全书索引需要单独确认。
        </p>
        <button
          disabled={downloading || !!ai.account.login}
          onClick={() => {
            if (confirm("重新准备组件将中断当前 AI 连接，继续？"))
              void ai.operate("runtime");
          }}
        >
          重新准备组件
        </button>
      </details>
    </section>
  );
}
export function ModelPicker() {
  const ai = useAi();
  const model = ai.models.find((m) => m.model === ai.choice?.model);
  const valid = !!model?.supportedReasoningEfforts.some(
    (e) => e.reasoningEffort === ai.choice?.effort,
  );
  return (
    <div className="model-picker">
      <select
        aria-label="模型"
        value={ai.choice?.model ?? ""}
        disabled={!ai.models.length}
        onChange={(e) => {
          const m = ai.models.find((x) => x.model === e.target.value)!;
          void ai.choose({ model: m.model, effort: m.defaultReasoningEffort });
        }}
      >
        <option value="" disabled>
          选择模型
        </option>
        {ai.choice && !model && (
          <option value={ai.choice.model}>模型已不可用</option>
        )}
        {ai.models.map((m) => (
          <option key={m.model} value={m.model}>
            {m.displayName}
          </option>
        ))}
      </select>
      <select
        aria-label="思考强度"
        value={ai.choice?.effort ?? ""}
        disabled={!model}
        onChange={(e) =>
          void ai.choose({ model: model!.model, effort: e.target.value })
        }
      >
        {!valid && <option value={ai.choice?.effort ?? ""}>请选择强度</option>}
        {model?.supportedReasoningEfforts.map((e) => (
          <option key={e.reasoningEffort} value={e.reasoningEffort}>
            {{
              none: "无",
              minimal: "极低",
              low: "低",
              medium: "中",
              high: "高",
              xhigh: "极高",
              max: "最大",
              ultra: "超高",
            }[e.reasoningEffort] ?? e.reasoningEffort}
          </option>
        ))}
      </select>
    </div>
  );
}
