import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type {
  Book,
  ReadingSelection,
  PdfAnchor,
} from "../../../packages/protocol/src";
import type { WorkspaceCard } from "../../../packages/protocol/src/workspace";
import {
  PdfReader,
  type PdfReaderProps,
  type WorkspacePage,
} from "./PdfReader";
import { useWorkspace } from "./WorkspaceState";
import "./workspace.css";

export interface BookWorkspaceHandle {
  flush(): Promise<boolean>;
  excerpt(selection: ReadingSelection): void;
}
export const BookWorkspace = forwardRef<
  BookWorkspaceHandle,
  PdfReaderProps & { book: Book; page: number }
>(function BookWorkspace(props, ref) {
  const state = useWorkspace(props.book.id);
  const [selected, setSelected] = useState<string>();
  const [linkFrom, setLinkFrom] = useState<string>();
  const [focus, setFocus] = useState(false);
  const [sourceFocus, setSourceFocus] = useState<PdfAnchor[]>();
  const [returnPosition, setReturnPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [gesture, setGesture] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const viewport = useRef<HTMLDivElement | null>(null);
  const pages = useRef<WorkspacePage[]>([]);
  const pointer = useRef<
    | {
        id: string;
        mode: "move" | "resize";
        x: number;
        y: number;
        card: WorkspaceCard;
      }
    | undefined
  >(undefined);
  function add(selection?: ReadingSelection) {
    if (!state.value) return;
    const page = pages.current.find(
      (item) => item.page === (selection?.page ?? props.page),
    );
    if (!page) return;
    const card: WorkspaceCard = {
      id: crypto.randomUUID(),
      kind: selection ? "excerpt" : "note",
      title: selection
        ? `第 ${props.book.labels[selection.page - 1] ?? selection.page} 页摘录`
        : "新笔记",
      text: selection?.text ?? "",
      comment: "",
      x: page.x + page.width + 72,
      y: Math.max(page.y, (viewport.current?.scrollTop ?? 0) / props.zoom + 60),
      width: 300,
      height: 260,
      ...(selection
        ? {
            source: {
              fingerprint: props.book.fingerprint,
              anchors: structuredClone(selection.anchors),
            },
          }
        : {}),
    };
    // Stagger cards near the same reading location instead of hiding them under one another.
    while (
      state.value.cards.some(
        (old) => Math.abs(old.x - card.x) < 20 && Math.abs(old.y - card.y) < 40,
      )
    )
      card.y += 50;
    state.change({ ...state.value, cards: [...state.value.cards, card] });
    setSelected(card.id);
    setFocus(false);
    requestAnimationFrame(() =>
      viewport.current?.scrollTo({
        left: Math.max(
          0,
          (card.x + card.width) * props.zoom -
            viewport.current.clientWidth +
            40,
        ),
      }),
    );
  }
  useImperativeHandle(ref, () => ({ flush: state.flush, excerpt: add }));
  function update(id: string, change: Partial<WorkspaceCard>) {
    if (state.value)
      state.change({
        ...state.value,
        cards: state.value.cards.map((card) =>
          card.id === id ? { ...card, ...change } : card,
        ),
      });
  }
  function select(card: WorkspaceCard) {
    setSelected(card.id);
    setFocus(false);
    if (linkFrom && linkFrom !== card.id && state.value) {
      state.change({
        ...state.value,
        links: [
          ...state.value.links,
          {
            id: crypto.randomUUID(),
            from: linkFrom,
            to: card.id,
            label: "关联",
          },
        ],
      });
      setLinkFrom(undefined);
    }
  }
  function source(card: WorkspaceCard) {
    const page = pages.current.find(
        (page) => page.page === card.source?.anchors[0].page,
      ),
      el = viewport.current;
    if (!page || !el) return;
    setReturnPosition({
      x: el.scrollLeft / props.zoom,
      y: el.scrollTop / props.zoom,
    });
    const location = page.locate(card.source!.anchors[0].rects[0]);
    setSourceFocus(card.source!.anchors);
    el.scrollTo({
      left: Math.max(0, page.x * props.zoom - 30),
      top: location.y * props.zoom - 100,
    });
  }
  function overlay(layout: WorkspacePage[], el: HTMLDivElement | null) {
    pages.current = layout;
    viewport.current = el;
    if (!state.value) return null;
    const cards = state.value.cards.map((card) =>
      gesture?.id === card.id ? { ...card, ...gesture } : card,
    );
    return (
      <div
        className={`workspace-objects${focus ? " focus-document" : ""}`}
        style={{ transform: `scale(${props.zoom})` }}
      >
        <svg
          className="workspace-links"
          aria-label="卡片关系"
          width={Math.max(
            2000,
            ...cards.map((card) => card.x + card.width + 100),
          )}
          height={Math.max(
            1000,
            ...cards.map((card) => card.y + card.height + 100),
          )}
        >
          {state.value.links.map((link) => {
            const from = cards.find((card) => card.id === link.from),
              to = cards.find((card) => card.id === link.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width / 2,
              y1 = from.y + from.height / 2,
              x2 = to.x + to.width / 2,
              y2 = to.y + to.height / 2;
            return (
              <g key={link.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                <foreignObject
                  x={(x1 + x2) / 2 - 80}
                  y={(y1 + y2) / 2 - 16}
                  width={160}
                  height={40}
                >
                  <button
                    className="workspace-link"
                    onClick={() => {
                      setSelected(link.from);
                      setLinkFrom(undefined);
                    }}
                    title={link.label}
                  >
                    {link.label}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
        {cards.map((card) => (
          <article
            key={card.id}
            className={`workspace-card${selected === card.id ? " selected" : ""}`}
            data-card-id={card.id}
            style={{
              left: card.x,
              top: card.y,
              width: card.width,
              height: card.height,
            }}
            onPointerDown={() => select(card)}
          >
            <header
              tabIndex={0}
              aria-label="移动卡片（方向键）"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                const step = event.shiftKey ? 40 : 10;
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault();
                  update(card.id, {
                    x: Math.max(
                      0,
                      Math.min(
                        1000000,
                        card.x +
                          (event.key === "ArrowRight"
                            ? step
                            : event.key === "ArrowLeft"
                              ? -step
                              : 0),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1000000,
                        card.y +
                          (event.key === "ArrowDown"
                            ? step
                            : event.key === "ArrowUp"
                              ? -step
                              : 0),
                      ),
                    ),
                  });
                }
              }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("button,input"))
                  return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = {
                  id: card.id,
                  mode: "move",
                  x: event.clientX,
                  y: event.clientY,
                  card,
                };
              }}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancel}
            >
              <span>{card.kind === "excerpt" ? "原文摘录" : "个人笔记"}</span>
              {card.source && (
                <button onClick={() => source(card)}>回到原文 ↗</button>
              )}
            </header>
            <input
              aria-label="卡片标题"
              value={card.title}
              maxLength={200}
              onChange={(e) => update(card.id, { title: e.target.value })}
            />
            {card.kind === "excerpt" ? (
              <blockquote>{card.text}</blockquote>
            ) : (
              <textarea
                aria-label="个人笔记内容"
                placeholder="写下你的理解…"
                value={card.text}
                maxLength={20000}
                onChange={(e) => update(card.id, { text: e.target.value })}
              />
            )}
            {card.kind === "excerpt" && (
              <textarea
                aria-label="摘录个人评论"
                placeholder="添加个人理解（不改变原文）…"
                value={card.comment}
                maxLength={10000}
                onChange={(e) => update(card.id, { comment: e.target.value })}
              />
            )}
            <footer>
              <button
                aria-pressed={linkFrom === card.id}
                onClick={() =>
                  setLinkFrom(linkFrom === card.id ? undefined : card.id)
                }
              >
                连接
              </button>
              <button
                onClick={() => {
                  state.change({
                    ...state.value!,
                    cards: state.value!.cards.filter(
                      (item) => item.id !== card.id,
                    ),
                    links: state.value!.links.filter(
                      (link) => link.from !== card.id && link.to !== card.id,
                    ),
                  });
                  if (linkFrom === card.id) setLinkFrom(undefined);
                }}
              >
                删除
              </button>
            </footer>
            <button
              className="workspace-resize"
              aria-label="调整卡片大小"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = {
                  id: card.id,
                  mode: "resize",
                  x: event.clientX,
                  y: event.clientY,
                  card,
                };
              }}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancel}
              onKeyDown={(e) => {
                const delta = e.shiftKey ? 40 : 10;
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  update(card.id, {
                    width: Math.max(
                      220,
                      Math.min(
                        1200,
                        card.width +
                          (e.key === "ArrowRight"
                            ? delta
                            : e.key === "ArrowLeft"
                              ? -delta
                              : 0),
                      ),
                    ),
                    height: Math.max(
                      160,
                      Math.min(
                        1600,
                        card.height +
                          (e.key === "ArrowDown"
                            ? delta
                            : e.key === "ArrowUp"
                              ? -delta
                              : 0),
                      ),
                    ),
                  });
                }
              }}
            >
              ⌟
            </button>
          </article>
        ))}
      </div>
    );
  }
  function move(e: React.PointerEvent) {
    const p = pointer.current;
    if (!p) return;
    const dx = (e.clientX - p.x) / props.zoom,
      dy = (e.clientY - p.y) / props.zoom;
    setGesture({
      id: p.id,
      x: Math.max(
        0,
        Math.min(1000000, p.card.x + (p.mode === "move" ? dx : 0)),
      ),
      y: Math.max(
        0,
        Math.min(1000000, p.card.y + (p.mode === "move" ? dy : 0)),
      ),
      width: Math.max(
        220,
        Math.min(1200, p.card.width + (p.mode === "resize" ? dx : 0)),
      ),
      height: Math.max(
        160,
        Math.min(1600, p.card.height + (p.mode === "resize" ? dy : 0)),
      ),
    });
  }
  function finish() {
    if (gesture && pointer.current) {
      const { id, ...geometry } = gesture;
      update(id, geometry);
    }
    cancel();
  }
  function cancel() {
    pointer.current = undefined;
    setGesture(undefined);
  }
  return (
    <>
      <PdfReader
        {...props}
        workspace={{
          width: Math.max(
            1600,
            ...(state.value?.cards.map((card) => card.x + card.width + 100) ??
              []),
          ),
          height: Math.max(
            0,
            ...(state.value?.cards.map((card) => card.y + card.height + 100) ??
              []),
          ),
          render: overlay,
          sourceFocus,
        }}
      />
      <div className="workspace-toolbar" role="toolbar" aria-label="工作区工具">
        <button disabled={!state.value} onClick={() => add()}>
          ＋ 笔记卡片
        </button>
        <button disabled={!state.canUndo} onClick={state.undo}>
          撤销
        </button>
        <button aria-pressed={focus} onClick={() => setFocus(!focus)}>
          聚焦正文
        </button>
        {returnPosition && (
          <button
            onClick={() => {
              viewport.current?.scrollTo({
                left: returnPosition.x * props.zoom,
                top: returnPosition.y * props.zoom,
              });
              setReturnPosition(undefined);
              setSourceFocus(undefined);
            }}
          >
            返回卡片位置
          </button>
        )}
        <span role="status">{state.status}</span>
      </div>
      {linkFrom && (
        <div className="workspace-notice">
          点击另一张卡片建立连接{" "}
          <button onClick={() => setLinkFrom(undefined)}>取消</button>
        </div>
      )}
      {selected &&
        state.value?.links.some(
          (link) => link.from === selected || link.to === selected,
        ) && (
          <aside className="workspace-relations" aria-label="已选卡片的关系">
            {state.value.links
              .filter((link) => link.from === selected || link.to === selected)
              .map((link) => (
                <label key={link.id}>
                  <input
                    aria-label="关系名称"
                    value={link.label}
                    maxLength={200}
                    onChange={(e) =>
                      state.change({
                        ...state.value!,
                        links: state.value!.links.map((item) =>
                          item.id === link.id
                            ? { ...item, label: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <button
                    aria-label="删除关系"
                    onClick={() =>
                      state.change({
                        ...state.value!,
                        links: state.value!.links.filter(
                          (item) => item.id !== link.id,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </label>
              ))}
          </aside>
        )}
      {state.error && (
        <div className="workspace-error" role="alert">
          {state.error}
          {state.value ? (
            <>
              <button onClick={() => void state.flush()}>重试保存</button>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(state.value, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `AIReader-workspace-${props.book.id}-draft.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                下载草稿备份
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "重新加载会替换当前未保存草稿。请先下载草稿备份。确定重新加载？",
                    )
                  )
                    void state.reload();
                }}
              >
                重新加载已保存版本
              </button>
            </>
          ) : (
            <button onClick={() => void state.reload()}>重试加载</button>
          )}
        </div>
      )}
    </>
  );
});
