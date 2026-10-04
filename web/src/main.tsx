import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n";
import { initColorScheme } from "./layout/color-scheme";
import { App } from "./app";

initColorScheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
