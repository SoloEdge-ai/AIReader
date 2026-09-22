import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ModelControl } from "../../apps/web/src/ModelControl";
import "../../apps/web/src/style.css";
import type { ModelOption, ModelSelection } from "../../packages/protocol/src";

const models: ModelOption[] = [
  {
    id: "test-a",
    model: "test-a",
    displayName: "Reader model A",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Quick" },
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "ultra", description: "Deep" },
    ],
  },
  {
    id: "test-b",
    model: "test-b",
    displayName: "Reader model B",
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [
      { reasoningEffort: "high", description: "Detailed" },
    ],
  },
];
function Fixture() {
  const [choice, setChoice] = useState<ModelSelection | null>({
    model: "test-a",
    effort: "medium",
  });
  const [available, setAvailable] = useState(true);
  const [fail, setFail] = useState(false);
  return (
    <main style={{ padding: 16 }}>
      <button onClick={() => (document.documentElement.dataset.theme = "dark")}>
        Dark
      </button>
      <button onClick={() => setAvailable(false)}>Remove models</button>
      <button onClick={() => setFail(!fail)}>Fail save</button>
      <button onClick={() => setChoice({ model: "retired", effort: "ultra" })}>
        Retire choice
      </button>
      <div style={{ position: "fixed", bottom: 20, right: 16 }}>
        <ModelControl
          models={available ? models : []}
          choice={choice}
          onChoose={async (value) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fail) throw new Error("Unavailable");
            setChoice(value);
          }}
        />
      </div>
      <output aria-label="Saved choice">{JSON.stringify(choice)}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
