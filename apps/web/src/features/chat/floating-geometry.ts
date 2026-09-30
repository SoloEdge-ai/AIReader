// Chat keeps its established geometry API; windows share one gesture and bounds policy.
import { defaultWindow, type WindowBounds } from "../../ui/floating-window/geometry";

export function defaultChatWindow(bounds: WindowBounds) {
  const initial = defaultWindow(bounds);
  const width = Math.min(380, initial.width);
  return { ...initial, x: initial.x + initial.width - width, width, height: Math.min(520, initial.height) };
}

export {
  clampWindow as clampChatWindow,
  moveWindow as moveChatWindow, resizeWindow as resizeChatWindow,
  persistedWindow as persistedChatWindow,
  type ResizeEdge, type WindowBounds,
} from "../../ui/floating-window/geometry";
