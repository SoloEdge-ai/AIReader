// Chat keeps its established geometry API; windows share one gesture and bounds policy.
export {
  defaultWindow as defaultChatWindow, clampWindow as clampChatWindow,
  moveWindow as moveChatWindow, resizeWindow as resizeChatWindow,
  persistedWindow as persistedChatWindow,
  type ResizeEdge, type WindowBounds,
} from "../../ui/floating-window/geometry";
