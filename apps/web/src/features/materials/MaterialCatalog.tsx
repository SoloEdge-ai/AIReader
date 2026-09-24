import { useEffect, useMemo, useState } from "react";
import type { Note } from "../../../../../packages/protocol/src/notes";
import type { BookWorkspace, WorkspaceObject } from "../../../../../packages/protocol/src/workspace";
import "./material-catalog.css";

type Catalog = Pick<BookWorkspace, "cards" | "objects" | "links">;
const objectName = (object: WorkspaceObject) => object.kind === "ink"
  ? object.brush === "pen" ? "画笔笔迹" : "荧光笔笔迹"
  : object.kind === "text" ? object.text.trim().slice(0, 40) || "文字"
    : ({ rectangle: "矩形", ellipse: "椭圆", line: "直线", arrow: "箭头" }[object.shape]);

function CatalogRow({ id, title, locateLabel = title, detail, onLocate, onAdd }: {
  id: string; title: string; locateLabel?: string; detail: string;
  onLocate: (id: string) => void;
  onAdd: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  return <div className="material-card-row">
    <button aria-label={`定位${locateLabel}`} onClick={() => onLocate(id)}>
      <span>{title}</span><small>{detail}</small>
    </button>
    <button className="material-card-add" aria-label={`将${title}加入提问`} title="加入提问"
      onClick={() => void onAdd(id).then(() => setError("")).catch((cause) => setError(String(cause)))}>＋</button>
    {error && <small className="material-card-error" role="alert">{error}</small>}
  </div>;
}

/** Lightweight navigation projection; the workspace remains owned by the editor. */
export function MaterialCatalog({ bookId, catalog, notes, query, onLocate, onAdd }: {
  bookId: string;
  catalog?: Catalog;
  notes: Note[];
  query: string;
  onLocate: (id: string) => void;
  onAdd: (id: string) => Promise<void>;
}) {
  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [bookId, query]);
  const titles = useMemo(() => new Map(notes.map((note) => [note.id, note.title])), [notes]);
  const search = query.toLocaleLowerCase();
  const cards = (catalog?.cards ?? []).filter((card) =>
    `${card.noteId ? titles.get(card.noteId) ?? "未命名笔记" : card.title} ${card.text}`
      .toLocaleLowerCase().includes(search));
  const objects = (catalog?.objects ?? []).filter((object) =>
    objectName(object).toLocaleLowerCase().includes(search));
  const links = (catalog?.links ?? []).filter((link) =>
    (link.label || "关系连线").toLocaleLowerCase().includes(search));
  return <>
    <section className="material-card-list" aria-label="画布卡片">
      <h3>画布卡片 <small>{catalog?.cards.length ?? 0}</small></h3>
      {cards.map((card) => {
        const title = card.noteId ? titles.get(card.noteId) ?? "未命名笔记" : card.title || "未命名卡片";
        const page = card.region?.page ?? card.source?.anchors[0]?.page;
        return <CatalogRow key={card.id} id={card.id} title={title} locateLabel={`${title}卡片`}
          detail={`${page ? `第 ${page} 页 · ` : ""}${card.kind === "note" ? "个人笔记" : card.kind === "region" ? "图片摘录" : "原文摘录"}`}
          onLocate={onLocate} onAdd={onAdd} />;
      })}
      {!catalog?.cards.length && <p>画布上还没有卡片</p>}
    </section>
    <section className="material-card-list" aria-label="画布对象">
      <h3>画布对象 <small>{(catalog?.objects.length ?? 0) + (catalog?.links.length ?? 0)}</small></h3>
      {objects.slice(0, limit).map((object) => <CatalogRow key={object.id} id={object.id}
        title={objectName(object)} detail={object.kind === "ink" ? "个人笔迹" :
          object.surface.kind === "pdf" ? `第 ${object.surface.page} 页` : "白板"}
        onLocate={onLocate} onAdd={onAdd} />)}
      {links.slice(0, Math.max(0, limit - objects.length)).map((link) =>
        <CatalogRow key={link.id} id={link.id} title={link.label || "关系连线"}
          detail="对象关系" onLocate={onLocate} onAdd={onAdd} />)}
      {objects.length + links.length > limit && <button onClick={() => setLimit((old) => old + 100)}>
        显示更多对象</button>}
      {!catalog?.objects.length && !catalog?.links.length && <p>尚无笔迹、文字、形状或连线</p>}
    </section>
  </>;
}
