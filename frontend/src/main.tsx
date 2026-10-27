import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
// The palette first: index.css and every component read its tokens (#1302).
import "./styles/palette.css";
import "./index.css";
import { useUIStore } from "./stores/uiStore";
import { syncDeveloperModeWithMacApp } from "./utils/macAppSettings";
import { installBusyFetch } from "./stores/busyStore";

// Every backend request the user causes shows the wheel of patience once it
// runs past the threshold (#38).
installBusyFetch();

// Inside the Mac app, developer mode is kept by the app (PsyNeuView-MacApp#200);
// in a browser this does nothing.
syncDeveloperModeWithMacApp({
  get: () => useUIStore.getState().developerMode,
  set: (on) => useUIStore.getState().setDeveloperMode(on),
  subscribe: (listener) =>
    useUIStore.subscribe((s, prev) => {
      if (s.developerMode !== prev.developerMode) listener(s.developerMode);
    }),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
