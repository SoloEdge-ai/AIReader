import type { ReaderPreferences } from "../../../packages/protocol/src";
import { Icon } from "./Icon";
export function Settings({
  prefs,
  onChange,
  onClose,
  children,
}: {
  prefs: ReaderPreferences;
  onChange: (p: ReaderPreferences) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <header>
          <h2>设置</h2>
          <button autoFocus aria-label="关闭设置" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <h3>外观</h3>
        <label className="setting-row">
          主题
          <select
            aria-label="主题"
            value={prefs.theme}
            onChange={(e) =>
              onChange({
                ...prefs,
                theme: e.target.value as ReaderPreferences["theme"],
              })
            }
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        {children}
        <details>
          <summary>实验功能</summary>
          <label className="setting-row">
            <span>
              编程工具
              <br />
              <small>需要通过隔离检查，默认关闭</small>
            </span>
            <input
              type="checkbox"
              checked={prefs.experimentalTools}
              onChange={(e) =>
                onChange({ ...prefs, experimentalTools: e.target.checked })
              }
            />
          </label>
        </details>
        <details>
          <summary>关于 AIReader</summary>
          <p>Windows 11 x64 · 免安装桌面阅读器</p>
          <p>
            书籍、批注和笔记保存在本机用户目录。AI
            问答会按需发送相关原文；全书索引需要另行确认。
          </p>
        </details>
      </section>
    </div>
  );
}
