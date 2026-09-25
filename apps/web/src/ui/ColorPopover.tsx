import { Popover } from "./Popover";

export type ColorOption = { value: string; name: string; hex: string };

/** Compact color control shared by source annotations and editable canvas objects. */
export function ColorPopover({ label, value, options, onChange, custom = false }: {
  label: string;
  value: string;
  options: readonly ColorOption[];
  onChange: (value: string) => void;
  custom?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  const hex = selected?.hex ?? (/^#[0-9a-fA-F]{6}$/.test(value) ? value : options[0]?.hex ?? "#345d84");
  return <Popover label={label} triggerLabel={`${label}：${selected?.name ?? "自定义"}`}
    trigger={<span className="reader-color-dot" style={{ background: hex }} />} width={180}>
    {(close) => <div className="reader-color-options">
      {options.map((option) => <button key={option.value} aria-label={option.name}
        aria-pressed={value === option.value} onClick={() => { onChange(option.value); close(); }}>
        <span className="reader-color-dot" style={{ background: option.hex }} />{option.name}
      </button>)}
      {custom && <label className="reader-custom-color">自定义
        <input type="color" aria-label="自定义对象颜色" value={hex}
          onChange={(event) => onChange(event.target.value)} />
      </label>}
    </div>}
  </Popover>;
}
