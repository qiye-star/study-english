import { defineConfig, devices } from "@playwright/test";
import { SPEECH_WAV } from "./e2e/support/fake-mic";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${process.env.E2E_FAKE_AUDIO ?? SPEECH_WAV}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    { name: "webkit-mobile", use: { ...devices["iPhone 14"] } },
  ],
});
