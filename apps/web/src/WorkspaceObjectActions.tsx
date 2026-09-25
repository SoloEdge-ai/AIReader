import type { CSSProperties } from "react";
import type { Annotation } from "../../../packages/protocol/src";
import type { InkStroke, WorkspaceObject } from "../../../packages/protocol/src/workspace";
import { annotationColors } from "./ui/annotationColors";
import { ColorPopover } from "./ui/ColorPopover";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";

const objectColors = [
  { value: "#345d84", name: "蓝灰", hex: "#345d84" },
  { value: "#222222", name: "黑色", hex: "#222222" },
  { value: "#d35e45", name: "红色", hex: "#d35e45" },
  { value: "#e6b72d", name: "黄色", hex: "#e6b72d" },
  { value: "#69b28d", name: "绿色", hex: "#69b28d" },
] as const;
type EditableObject = Exclude<WorkspaceObject, InkStroke>;

/** Object actions share the PDF selection surface while mutations remain in the book session. */
export function WorkspaceObjectActions({ style, count, fixedSource, annotation, colorObject,
  styleObject, materialBusy, canAddToQuestion, onSource, onAnnotationColor,
  onObjectColor, onUpdateObjects, onConnect, onAddToQuestion, onDelete,
}: {
  style: CSSProperties;
  count: number;
  fixedSource: boolean;
  annotation?: Annotation;
  colorObject?: WorkspaceObject;
  styleObject?: EditableObject;
  materialBusy: boolean;
  canAddToQuestion: boolean;
  onSource: (annotation: Annotation) => void;
  onAnnotationColor: (annotation: Annotation, color: Annotation["color"]) => void;
  onObjectColor: (color: string) => void;
  onUpdateObjects: (change: (object: EditableObject) => WorkspaceObject) => void;
  onConnect: () => void;
  onAddToQuestion: () => void;
  onDelete: () => void;
}) {
  return <div className="reader-context-bar workspace-object-toolbar" role="toolbar"
    aria-label="对象操作" style={style}>
    <span>{count > 1 ? `${count} 个对象` : "已选中"}</span>
    {fixedSource && <span className="workspace-fixed-source" title="源批注不能移动">原文固定</span>}
    {annotation && <>
      <button aria-label="回到批注原文" title="回到批注原文"
        onClick={() => onSource(annotation)}><Icon name="outward" /></button>
      <ColorPopover label="批注颜色" value={annotation.color} options={annotationColors}
        onChange={(value) => {
          const option = annotationColors.find((item) => item.value === value);
          if (option && option.value !== annotation.color) onAnnotationColor(annotation, option.value);
        }} />
    </>}
    {colorObject && <ColorPopover label="对象颜色" value={colorObject.color}
      options={objectColors} custom onChange={onObjectColor} />}
    {styleObject && <Popover key={styleObject.id} label="对象格式设置" triggerLabel="对象格式"
      trigger={<Icon name="more" />} placement="bottom" width={180}
      className="workspace-object-style" autoFocusFirst>
      {() => <div role="group" aria-label="对象格式设置">
        {styleObject.kind === "text" ? <>
          <label>字号<input aria-label="文字字号" type="number" min={8} max={120}
            value={styleObject.fontSize} onChange={(event) => {
              const fontSize = Number(event.target.value);
              if (fontSize >= 8 && fontSize <= 120) onUpdateObjects((object) =>
                object.kind === "text" ? { ...object, fontSize } : object);
            }} /></label>
          <label><input aria-label="粗体文字" type="checkbox" checked={styleObject.bold}
            onChange={(event) => onUpdateObjects((object) => object.kind === "text" ?
              { ...object, bold: event.target.checked } : object)} />粗体</label>
          <label>对齐<select aria-label="文字对齐" value={styleObject.align}
            onChange={(event) => onUpdateObjects((object) => object.kind === "text" ?
              { ...object, align: event.target.value as "left" | "center" | "right" } : object)}>
            <option value="left">左</option><option value="center">中</option>
            <option value="right">右</option></select></label>
        </> : styleObject.kind === "shape" ? <>
          <label>线宽<select aria-label="形状线宽" value={styleObject.strokeWidth}
            onChange={(event) => onUpdateObjects((object) => object.kind === "shape" ?
              { ...object, strokeWidth: Number(event.target.value) } : object)}>
            {[1, 2, 4, 8].map((width) => <option key={width} value={width}>{width}</option>)}
          </select></label>
          <label><input aria-label="填充形状" type="checkbox" checked={!!styleObject.fill}
            onChange={(event) => onUpdateObjects((object) => object.kind === "shape" ?
              { ...object, fill: event.target.checked ? object.color : undefined,
                fillOpacity: event.target.checked ? (object.fillOpacity ?? .2) : undefined } : object)} />填充</label>
          {styleObject.fill && <label>透明度<select aria-label="形状填充透明度"
            value={styleObject.fillOpacity ?? .2}
            onChange={(event) => onUpdateObjects((object) => object.kind === "shape" ?
              { ...object, fillOpacity: Number(event.target.value) } : object)}>
            {[.15, .2, .3, .5, .75].map((opacity) => <option key={opacity} value={opacity}>
              {Math.round(opacity * 100)}%</option>)}
          </select></label>}
        </> : null}
      </div>}
    </Popover>}
    <button aria-label="连接选中对象" title="点击另一个对象建立关系"
      onClick={onConnect}><Icon name="link" /></button>
    {canAddToQuestion && <button aria-label="将选中对象加入提问" title="加入本轮材料，不会立即发送"
      disabled={materialBusy} onClick={onAddToQuestion}><Icon name="chat" /></button>}
    <button aria-label="删除选中对象" title="删除选中对象" onClick={onDelete}>
      <Icon name="trash" /></button>
  </div>;
}
