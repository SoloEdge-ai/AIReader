import { useEffect, useMemo, useState } from "react";
import type { Note } from "../../../../../packages/protocol/src/notes";
import type { BookWorkspace } from "../../../../../packages/protocol/src/workspace";
import { buildMaterialCatalog, selectMaterialCatalog, type MaterialCategory, type MaterialSort } from "./catalog-model";
import "./material-catalog.css";

type Catalog = Pick<BookWorkspace, "cards" | "objects" | "links" | "groups">;

function CatalogRow({ id, title, locateLabel = title, detail, canLocate, canRestore, onLocate, onAdd, onRestore }: {
  id: string; title: string; locateLabel?: string; detail: string; canLocate: boolean; canRestore: boolean;
  onLocate: (id: string) => void;
  onAdd: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  return <div className="material-card-row" data-material-id={id}>
    <button aria-label={`定位${locateLabel}`} onClick={() => onLocate(id)} disabled={!canLocate}>
      <span>{title}</span><small>{detail}</small>
    </button>
    {canRestore && <button className="material-card-restore" aria-label={`将${title}放回工作台`}
      onClick={() => void onRestore(id).then(() => setError("")).catch((cause) => setError(String(cause)))}>放回</button>}
    <button className="material-card-add" aria-label={`将${title}加入提问`} title="加入提问"
      onClick={() => void onAdd(id).then(() => setError("")).catch((cause) => setError(String(cause)))}>＋</button>
    {error && <small className="material-card-error" role="alert">{error}</small>}
  </div>;
}

/** Lightweight navigation projection; the workspace remains owned by the editor. */
export function MaterialCatalog({ bookId, catalog, notes, query, onLocate, onAdd, onRestore }: {
  bookId: string;
  catalog?: Catalog;
  notes: Note[];
  query: string;
  onLocate: (id: string) => void;
  onAdd: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [limit, setLimit] = useState(100);
  const [category, setCategory] = useState<MaterialCategory>("all");
  const [sort, setSort] = useState<MaterialSort>("page");
  const [groupId, setGroupId] = useState("");
  useEffect(() => { setLimit(100); setGroupId(""); }, [bookId]);
  useEffect(() => setLimit(100), [query, category, sort, groupId]);
  const entries = useMemo(() => buildMaterialCatalog(catalog, notes), [catalog, notes]);
  const visible = useMemo(() => selectMaterialCatalog(entries, { query, category, sort, groupId }),
    [entries, query, category, sort, groupId]);
  return <>
    <section className="material-card-list" aria-label="本书材料">
      <h3>本书材料 <small>{visible.length === entries.length ? entries.length : `${visible.length}/${entries.length}`}</small></h3>
      <div className="material-catalog-controls">
        <select aria-label="材料类型" value={category}
          onChange={(event) => setCategory(event.target.value as MaterialCategory)}>
          <option value="all">全部</option><option value="excerpt">摘录</option>
          <option value="note">笔记</option><option value="drawing">绘图</option>
        </select>
        <select aria-label="主题组筛选" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          <option value="">全部主题</option>
          {catalog?.groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
        </select>
        <select aria-label="画布材料排序" value={sort}
          onChange={(event) => setSort(event.target.value as MaterialSort)}>
          <option value="page">按页码</option><option value="type">按类型</option>
        </select>
      </div>
      {visible.slice(0, limit).map((entry) => <CatalogRow key={entry.id} id={entry.id}
        title={entry.title} locateLabel={entry.category === "excerpt" ||
          entry.category === "note" && catalog?.cards.some((card) => card.id === entry.id)
          ? `${entry.title}卡片` : entry.category === "note" ? `${entry.title}笔记` : entry.title}
        detail={entry.detail} canLocate={entry.placed !== false || entry.category === "note" &&
          !catalog?.cards.some((card) => card.id === entry.id)}
        canRestore={entry.placed === false} onLocate={onLocate} onAdd={onAdd} onRestore={onRestore} />)}
      {visible.length > limit && <button onClick={() => setLimit((old) => old + 100)}>
        显示更多材料</button>}
      {!entries.length && <p>画布上还没有材料</p>}
      {!!entries.length && !visible.length && <p>没有匹配的画布材料</p>}
    </section>
  </>;
}
