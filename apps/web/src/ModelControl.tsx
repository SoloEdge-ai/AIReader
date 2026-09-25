import { useEffect, useId, useRef, useState } from "react";
import type {
  ModelOption,
  ModelSelection,
} from "../../../packages/protocol/src";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";

const effortNames: Record<string, string> = {
  none: "无",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  ultra: "超高",
};
export const effortLabel = (value: string) => effortNames[value] ?? value;

/** Only service-advertised models and efforts are selectable; save after a gesture. */
export function ModelControl({
  models,
  choice,
  onChoose,
}: {
  models: ModelOption[];
  choice: ModelSelection | null;
  onChoose: (value: ModelSelection) => Promise<void>;
}) {
  const id = useId(),
    busy = useRef(false),
    draftValue = useRef<number | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<number | null>(null);
  const model = models.find((m) => m.model === choice?.model);
  const efforts = model?.supportedReasoningEfforts ?? [];
  const selected = efforts.findIndex(
    (e) => e.reasoningEffort === choice?.effort,
  );
  const displayed = draft ?? selected;
  const effort = efforts[displayed]
    ? effortLabel(efforts[displayed].reasoningEffort)
    : "重新选择";
  useEffect(() => {
    draftValue.current = null;
    setDraft(null);
  }, [choice?.model, choice?.effort]);

  async function choose(value: ModelSelection) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onChoose(value);
    } catch {
      setError("设置未保存，请重试。");
    } finally {
      busy.current = false;
      setPending(false);
      draftValue.current = null;
      setDraft(null);
    }
  }
  function commitEffort() {
    const value = draftValue.current;
    if (value === null || !model || !efforts[value]) return;
    draftValue.current = null;
    if (value === selected) {
      setDraft(null);
      return;
    }
    void choose({ model: model.model, effort: efforts[value].reasoningEffort });
  }
  return (
    <div className="model-control">
      <Popover
        label="模型与思考强度"
        triggerClass="model-trigger"
        className="model-popover"
        placement="top"
        disabled={!models.length}
        trigger={
          <>
            <Icon name="bolt" />
            <span className="model-trigger-copy">
              <strong>
                {models.length ? effort : "尚未连接"}
                <Icon name="chevron" />
              </strong>
              <span>
                {model?.displayName ??
                  (models.length ? "选择模型" : "登录后选择模型")}
              </span>
            </span>
          </>
        }
      >
        {() => (
          <>
            <div className="effort-heading">
              <Icon name="bolt" />
              <div>
                <strong>{model ? effort : "选择模型"}</strong>
                <span>{model?.displayName ?? "使用账号可用的模型"}</span>
              </div>
              <button
                aria-label="恢复模型默认强度"
                title="恢复模型默认强度"
                disabled={
                  !model ||
                  pending ||
                  choice?.effort === model.defaultReasoningEffort
                }
                onClick={() =>
                  model &&
                  void choose({
                    model: model.model,
                    effort: model.defaultReasoningEffort,
                  })
                }
              >
                <Icon name="reset" />
              </button>
            </div>
            {model && efforts.length > 1 && (
              <div className="effort-control">
                {selected < 0 && (
                  <p className="error">原思考强度不可用，请重新选择。</p>
                )}
                <input
                  className="effort-slider"
                  type="range"
                  aria-label="思考强度"
                  aria-disabled={pending}
                  min={0}
                  max={efforts.length - 1}
                  step={1}
                  value={Math.max(0, displayed)}
                  aria-valuetext={effort}
                  onChange={(e) => {
                    if (busy.current) return;
                    const value = Number(e.target.value);
                    draftValue.current = value;
                    setDraft(value);
                  }}
                  onPointerUp={commitEffort}
                  onKeyUp={commitEffort}
                  onBlur={commitEffort}
                  onPointerCancel={() => {
                    draftValue.current = null;
                    setDraft(null);
                  }}
                />
                <div className="effort-labels">
                  {efforts.map((e, index) => (
                    <button
                      key={e.reasoningEffort}
                      disabled={pending}
                      title={e.description}
                      aria-pressed={displayed === index}
                      onClick={() =>
                        void choose({
                          model: model.model,
                          effort: e.reasoningEffort,
                        })
                      }
                    >
                      {effortLabel(e.reasoningEffort)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {model && efforts.length === 1 && (
              <p className="single-effort">
                思考强度：{effortLabel(efforts[0].reasoningEffort)}
              </p>
            )}
            <fieldset className="model-options" disabled={pending}>
              <legend>模型</legend>
              {models.map((m) => (
                <label className="model-option" key={m.model}>
                  <input
                    type="radio"
                    name={`${id}-model`}
                    aria-label={m.displayName}
                    checked={choice?.model === m.model}
                    onChange={() =>
                      void choose({
                        model: m.model,
                        effort: m.defaultReasoningEffort,
                      })
                    }
                  />
                  <span>
                    <strong>{m.displayName}</strong>
                    {m.isDefault && <small>默认模型</small>}
                  </span>
                  <Icon name="check" />
                </label>
              ))}
            </fieldset>
            {pending && (
              <p className="model-save" role="status">
                正在保存…
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}
