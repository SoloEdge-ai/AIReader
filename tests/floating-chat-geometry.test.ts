import { expect, test } from "vitest";
import { clampChatWindow, defaultChatWindow, moveChatWindow, resizeChatWindow } from "../apps/web/src/features/chat/floating-geometry";

const bounds = { width: 1440, height: 900 };

test("floating chat starts inside the application and remains visible when the window shrinks", () => {
  const initial = defaultChatWindow(bounds);
  expect(initial).toEqual({ x: 1000, y: 72, width: 420, height: 680 });
  expect(clampChatWindow(initial, { width: 900, height: 640 })).toEqual({
    x: 468, y: 60, width: 420, height: 568,
  });
  const narrow = defaultChatWindow({ width: 900, height: 600 });
  expect(narrow.y + narrow.height).toBeLessThanOrEqual(520);
});

test("dragging cannot move the chat outside the application", () => {
  const initial = defaultChatWindow(bounds);
  expect(moveChatWindow(initial, -2000, -2000, bounds)).toMatchObject({ x: 12, y: 60 });
  expect(moveChatWindow(initial, 2000, 2000, bounds)).toMatchObject({ x: 1008, y: 208 });
});

test("all resize edges preserve the opposite side and enforce a usable minimum", () => {
  const initial = { x: 900, y: 150, width: 400, height: 500 };
  expect(resizeChatWindow(initial, "nw", -100, -50, bounds)).toEqual({
    x: 800, y: 100, width: 500, height: 550,
  });
  expect(resizeChatWindow(initial, "se", 500, 500, bounds)).toEqual({
    x: 900, y: 150, width: 528, height: 738,
  });
  expect(resizeChatWindow(initial, "w", 500, 0, bounds)).toEqual({
    x: 980, y: 150, width: 320, height: 500,
  });
});
