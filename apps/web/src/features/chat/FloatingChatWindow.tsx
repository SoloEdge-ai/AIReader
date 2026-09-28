import type { ReactNode } from "react";
import type { ChatWindowRect } from "../../../../../packages/protocol/src/preferences";
import { FloatingWindow } from "../../ui/floating-window/FloatingWindow";
import { defaultChatWindow, type WindowBounds } from "./floating-geometry";

export function FloatingChatWindow(props: {
  rect?: ChatWindowRect;
  bounds: WindowBounds;
  onCommit: (rect: ChatWindowRect) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return <FloatingWindow {...props} title="问答" label="AI 问答浮窗"
    className="floating-chat" defaultRect={defaultChatWindow} />;
}
