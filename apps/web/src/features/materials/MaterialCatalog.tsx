import { useEffect, useMemo, useState } from "react";
import type { Note } from "../../../../../packages/protocol/src/notes";
import type { BookWorkspace } from "../../../../../packages/protocol/src/workspace";
import { buildMaterialCatalog, selectMaterialCatalog, type MaterialCategory, type MaterialSort } from "./catalog-model";
import "./material-catalog.css";

type Catalog = Pick<BookWorkspace, "cards" | "objects" | "links">;

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
  const [category, setCategory] = useState<MaterialCategory>("all");
  const [sort, setSort] = useState<MaterialSort>("page");
  useEffect(() => setLimit(100), [bookId, query, category, sort]);
  const entries = useMemo(() => buildMaterialCatalog(catalog, notes), [catalog, notes]);
  const visible = useMemo(() => selectMaterialCatalog(entries, { query, category, sort }),
    [entries, query, category, sort]);
  return <>
    <section className="material-card-list" aria-label="画布材料">
      <h3>画布材料 <small>{visible.length === entries.length ? entries.length : `${visible.length}/${entries.length}`}</small></h3>
      <div className="material-catalog-controls">
        <select aria-label="画布材料类型" value={category}
          onChange={(event) => setCategory(event.target.value as MaterialCategory)}>
          <option value="all">全部类型</option><option value="card">卡片</option>
          <option value="ink">笔迹</option><option value="text">文字</option>
          <option value="shape">形状</option><option value="link">关系</option>
        </select>
        <select aria-label="画布材料排序" value={sort}
          onChange={(event) => setSort(event.target.value as MaterialSort)}>
          <option value="page">按原文位置</option><option value="type">按类型</option>
        </select>
      </div>
      {visible.slice(0, limit).map((entry) => <CatalogRow key={entry.id} id={entry.id}
        title={entry.title} locateLabel={entry.category === "card" ? `${entry.title}卡片` : entry.title}
        detail={entry.detail} onLocate={onLocate} onAdd={onAdd} />)}
      {visible.length > limit && <button onClick={() => setLimit((old) => old + 100)}>
        显示更多材料</button>}
      {!entries.length && <p>画布上还没有材料</p>}
      {!!entries.length && !visible.length && <p>没有匹配的画布材料</p>}
    </section>
  </>;
}
