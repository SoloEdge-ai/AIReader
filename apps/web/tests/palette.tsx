import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ToolPreferencesSchema,
  type ReaderTool,
} from "../../../packages/protocol/src";
import { ReaderToolPalette } from "../src/ReaderToolPalette";
import "../src/style.css";

function Harness() {
  const [tool, setTool] = useState<ReaderTool>("pointer");
  const [preferences, setPreferences] = useState(() =>
    ToolPreferencesSchema.parse({
      dock: new URLSearchParams(location.search).get("dock") || "bottom",
    }),
  );
  return (
    <div
      className="reading"
      style={{ position: "relative", width: "100vw", height: "100vh" }}
    >
      <ReaderToolPalette
        tool={tool}
        preferences={preferences}
        onTool={setTool}
        onPreferences={setPreferences}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
