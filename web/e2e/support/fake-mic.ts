import path from "node:path";
import type { Page } from "@playwright/test";

export const SPEECH_WAV = path.resolve(__dirname, "../../../enjoy/samples/jfk.wav");
export const SPEECH_REFERENCE =
  "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.";
const FIXTURE_PATH = "/__e2e__/speech.wav";

// e2e/ 下的 package.json 声明为 commonjs(Node 24 + Playwright 1.51 无法以 ESM 加载 TS),所以用 __dirname。
/** Chromium 由启动参数提供假麦克风;WebKit 没有这些参数,用 init script 替换 getUserMedia。 */
export async function useFakeMicrophone(page: Page, browserName: string): Promise<void> {
  if (browserName === "chromium") return;
  await page.route(`**${FIXTURE_PATH}`, (route) => route.fulfill({ path: SPEECH_WAV, contentType: "audio/wav" }));
  await page.addInitScript((url: string) => {
    const devices = navigator.mediaDevices;
    if (!devices) return;
    devices.getUserMedia = async () => {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const resumed = ctx.resume(); // 在点击手势内同步发起
      const data = await (await fetch(url)).arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const destination = ctx.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      await resumed;
      return destination.stream;
    };
  }, FIXTURE_PATH);
}
