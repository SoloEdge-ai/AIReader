import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ConnectionOverlay } from "../apps/web/src/features/connections/ConnectionOverlay";
import {
  bezierPath,
  clampPointToRect,
  convergenceOffsets,
  intersectRectEdge,
  projectConnections,
  rectCenter,
  type ConnectionOverlayItem,
} from "../apps/web/src/features/connections/geometry";

const container = { left: 240, top: 72, width: 1000, height: 720 };

describe("connection overlay geometry", () => {
  test("centers rectangles and intersects or clamps at a container edge", () => {
    expect(rectCenter({ left: 10, top: 20, width: 80, height: 40 })).toEqual({
      x: 50,
      y: 40,
    });
    expect(
      intersectRectEdge(
        { left: 0, top: 0, width: 200, height: 100 },
        { x: 100, y: 50 },
        { x: 400, y: 80 },
      ),
    ).toEqual({ x: 200, y: 60 });
    expect(
      clampPointToRect(
        { x: -40, y: 140 },
        { left: 0, top: 0, width: 200, height: 100 },
        8,
      ),
    ).toEqual({ x: 8, y: 92 });
  });

  test("uses current screen rectangles after independent PDF and board scrolling", () => {
    const initial = projectConnections(container, [
      {
        id: "source-1",
        kind: "source",
        from: { left: 300, top: 180, width: 80, height: 40 },
        to: { left: 920, top: 210, width: 240, height: 120 },
      },
    ]);
    const afterBothViewsMove = projectConnections(container, [
      {
        id: "source-1",
        kind: "source",
        from: { left: 300, top: 120, width: 80, height: 40 },
        to: { left: 840, top: 270, width: 240, height: 120 },
      },
    ]);
    expect(initial[0]!.from.point.y).toBeGreaterThan(
      afterBothViewsMove[0]!.from.point.y,
    );
    expect(initial[0]!.to.point.x).toBeGreaterThan(
      afterBothViewsMove[0]!.to.point.x,
    );
    expect(afterBothViewsMove[0]!.curve.path).not.toBe(initial[0]!.curve.path);
  });

  test("clips an offscreen source to the edge and retains its short page label", () => {
    const [connection] = projectConnections(
      container,
      [
        {
          id: "source-offscreen",
          kind: "source",
          from: { left: -400, top: 260, width: 120, height: 50 },
          to: { left: 900, top: 260, width: 220, height: 100 },
          offscreen: { from: { label: "p. 42" } },
        },
      ],
      { edgePadding: 8 },
    );
    expect(connection!.from).toMatchObject({
      offscreen: true,
      edge: "left",
      edgeLabel: "p. 42",
    });
    expect(connection!.from.point.x).toBe(8);
    expect(connection!.from.point.y).toBeGreaterThanOrEqual(8);
    expect(connection!.from.point.y).toBeLessThanOrEqual(container.height - 8);
  });

  test("handles zero-size anchors and suppresses geometry for a zero-size container", () => {
    const [connection] = projectConnections(container, [
      {
        id: "zero-anchor",
        kind: "relation",
        from: { left: 300, top: 200, width: 0, height: 0 },
        to: { x: 700, y: 500 },
      },
    ]);
    expect(connection!.from.point).toEqual({ x: 60, y: 128 });
    expect(connection!.curve.path).not.toContain("NaN");
    expect(
      projectConnections({ left: 0, top: 0, width: 0, height: 400 }, [
        {
          id: "hidden",
          kind: "source",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
        },
      ]),
    ).toEqual([]);
    expect(
      intersectRectEdge(
        { left: 10, top: 20, width: 0, height: 0 },
        { x: 10, y: 20 },
        { x: 200, y: 200 },
      ),
    ).toEqual({ x: 10, y: 20 });
  });

  test("bundles AI paths symmetrically while keeping one common target", () => {
    expect(convergenceOffsets(5, 12, 18)).toEqual([-18, -9, 0, 9, 18]);
    const items: ConnectionOverlayItem[] = [0, 1, 2].map((index) => ({
      id: `ai-${index}`,
      kind: index === 2 ? "ai-frozen" : "ai-preview",
      from: { left: 340, top: 140 + index * 150, width: 180, height: 80 },
      to: { left: 1040, top: 180, width: 160, height: 240 },
      convergeKey: "question-materials",
    }));
    const projected = projectConnections(container, items);
    expect(projected.map((item) => item.convergenceOffset)).toEqual([
      -10, 0, 10,
    ]);
    expect(
      new Set(projected.map((item) => `${item.to.point.x}:${item.to.point.y}`))
        .size,
    ).toBe(1);
    expect(new Set(projected.map((item) => item.curve.control2.y)).size).toBe(
      3,
    );
  });

  test("creates a stable cubic path and a pointer-transparent SVG", () => {
    expect(bezierPath({ x: 10, y: 20 }, { x: 110, y: 70 })).toBe(
      "M 10 20 C 48 20, 72 70, 110 70",
    );
    const markup = renderToStaticMarkup(
      createElement(ConnectionOverlay, {
        container,
        connections: [
          {
            id: "preview",
            kind: "ai-preview",
            from: { x: 300, y: 200 },
            to: { x: 1000, y: 300 },
            selected: true,
            label: "待加入",
          },
        ],
      }),
    );
    expect(markup).toContain("pointer-events:none");
    expect(markup).toContain('data-kind="ai-preview"');
    expect(markup).toContain("is-selected");
    expect(markup).toContain("待加入");
  });
});
