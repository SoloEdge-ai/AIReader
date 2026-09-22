import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { App } from "./App";
import { AiProvider } from "./AiState";
createRoot(document.getElementById("root")!).render(
  <AiProvider>
    <App />
  </AiProvider>,
);
