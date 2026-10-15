import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n";
import { initColorScheme } from "./layout/color-scheme";
import { initGlassQuality } from "./layout/glass-quality";
import { initGlassFlag } from "./lib/glass-flag";
import "./plugins"; // 组合层:登记全部扩展点贡献(spec 2026-10-11-learning-links §8.3)
import { App } from "./app";
import { installAudioUnlock } from "./audio/capture";
import { registerServiceWorker } from "./pwa/register-sw";

initColorScheme();
initGlassFlag(); // 液态玻璃开发开关(?glass=v2),默认关(计划 2026-10-15-liquid-glass)
initGlassQuality();
installAudioUnlock(); // R31:第一次 click/touchend 时解锁页面级 AudioContext(语音消息的 PCM 采集要求它已 running)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
