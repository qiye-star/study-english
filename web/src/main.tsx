import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n";
import { initColorScheme } from "./layout/color-scheme";
import { App } from "./app";
import { registerServiceWorker } from "./pwa/register-sw";

initColorScheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
