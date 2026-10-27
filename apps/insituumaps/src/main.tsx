import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { useAppStore } from "@/state/store";

import { App } from "./App";
import "./index.css";

// the store is reachable from the console and the smoke test
(window as unknown as { insituumaps: typeof useAppStore }).insituumaps =
  useAppStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
