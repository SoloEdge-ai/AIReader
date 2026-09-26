import { useEffect, useRef, useState } from "react";
import type { WorkspaceObject } from "../../../packages/protocol/src/workspace";
import type { WorkspacePage } from "../../../packages/workspace-engine/src/surfaces";
import { objectRect, shapeEndpoints } from "../../../packages/workspace-engine/src/objects";

export function WorkspaceObjectView({ object, pages, zoom, selected, editing, onSelect, onEdit, onCommit, onResize, offset }:
  { object: Exclude<WorkspaceObject, { kind: "ink" }>; pages: WorkspacePage[];
    zoom: number; selected: boolean; editing: boolean; onSelect: () => void; onEdit: () => void;
    onCommit: (text: string) => void; onResize: (dx: number, dy: number) => void;
    offset?: { x: number; y: number } }) {
  const [draft, setDraft] = useState(object.kind === "text" ? object.text : "");
  const resize = useRef<{ x: number; y: number }>(undefined);
  const [preview, setPreview] = useState<{ dx: number; dy: number }>();
  useEffect(() => { if (object.kind === "text" && !editing) setDraft(object.text); }, [object, editing]);
  const rect = objectRect(object, pages);
  if (!rect) return null;
  const className = `workspace-object ${object.kind}${selected ? " selected" : ""}`;
  const style = { left: rect.x + (offset?.x ?? 0), top: rect.y + (offset?.y ?? 0), width: Math.max(1, rect.width + (preview?.dx ?? 0)),
    height: Math.max(1, rect.height + (preview?.dy ?? 0)) };
  const handle = selected && !editing && <button className="workspace-object-resize" aria-label="调整对象大小"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      resize.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!resize.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      setPreview({ dx: (event.clientX - resize.current.x) / zoom,
        dy: (event.clientY - resize.current.y) / zoom });
    }}
    onPointerUp={(event) => {
      if (!resize.current) return;
      onResize((event.clientX - resize.current.x) / zoom, (event.clientY - resize.current.y) / zoom);
      resize.current = undefined; setPreview(undefined);
    }}
    onPointerCancel={() => { resize.current = undefined; setPreview(undefined); }} />;
  if (object.kind === "text")
    return <div className={className} data-object-id={object.id} style={{ ...style,
      color: object.color, fontSize: object.fontSize, fontWeight: object.bold ? 700 : 400,
      textAlign: object.align }} tabIndex={editing ? -1 : 0} aria-label="个人文本"
      onDoubleClick={onEdit} onKeyDown={(event) => { if (event.key === "Enter" && !editing) onEdit(); }}>
      {editing ? <textarea autoFocus aria-label="编辑画布文本" value={draft} maxLength={20000}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)} /> :
        <span>{object.text || "双击写字…"}</span>}
      {handle}
    </div>;
  const [a, b] = shapeEndpoints(object, pages);
  const x1 = (a?.[0] ?? rect.x) - rect.x, y1 = (a?.[1] ?? rect.y) - rect.y;
  const x2 = (b?.[0] ?? rect.x + rect.width) - rect.x, y2 = (b?.[1] ?? rect.y + rect.height) - rect.y;
  return <div className={className} data-object-id={object.id} style={style}
    tabIndex={0} role="button" aria-label={`个人${object.shape}`}
    onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
    <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`}
      overflow="visible" aria-hidden="true">
      {object.shape === "rectangle" ?
        <rect x={object.strokeWidth / 2} y={object.strokeWidth / 2}
          width={Math.max(1, rect.width - object.strokeWidth)} height={Math.max(1, rect.height - object.strokeWidth)}
          fill={object.fill ?? "transparent"} fillOpacity={object.fillOpacity ?? 0} stroke={object.color}
          strokeWidth={object.strokeWidth} /> : object.shape === "ellipse" ?
        <ellipse cx={rect.width / 2} cy={rect.height / 2}
          rx={Math.max(1, rect.width / 2 - object.strokeWidth / 2)}
          ry={Math.max(1, rect.height / 2 - object.strokeWidth / 2)}
          fill={object.fill ?? "transparent"} fillOpacity={object.fillOpacity ?? 0} stroke={object.color}
          strokeWidth={object.strokeWidth} /> :
        <g stroke={object.color} strokeWidth={object.strokeWidth} fill="none" strokeLinecap="round">
          <path d={`M ${x1} ${y1} L ${x2} ${y2}`} />
          {object.shape === "arrow" && (() => {
            const angle = Math.atan2(y2 - y1, x2 - x1), size = Math.max(8, object.strokeWidth * 4);
            const left = [x2 - size * Math.cos(angle - .5), y2 - size * Math.sin(angle - .5)];
            const right = [x2 - size * Math.cos(angle + .5), y2 - size * Math.sin(angle + .5)];
            return <path d={`M ${left[0]} ${left[1]} L ${x2} ${y2} L ${right[0]} ${right[1]}`} />;
          })()}
        </g>}
    </svg>
    {handle}
  </div>;
}
