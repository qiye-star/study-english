import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n";
import { initColorScheme } from "./layout/color-scheme";
import { App } from "./app";
import { installAudioUnlock } from "./audio/capture";
import { registerServiceWorker } from "./pwa/register-sw";

initColorScheme();
installAudioUnlock(); // R31:第一次 click/touchend 时解锁页面级 AudioContext(语音消息的 PCM 采集要求它已 running)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
