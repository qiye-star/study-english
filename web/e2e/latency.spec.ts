import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { recordFor } from "./support/mic";

// 只在 E2E_LATENCY=1 时运行(需要真实上游;结果写进 docs/superpowers/plans/2026-10-07-voice-latency.md)。
// E2E_FAKE_AUDIO 指向 .superpowers/latency/s5.wav 或 s15.wav;E2E_HOLD_MS 是"说话"时长(5000 或 15000)。
const RUNS = Number(process.env.E2E_LATENCY_RUNS ?? "5");
const HOLD_MS = Number(process.env.E2E_HOLD_MS ?? "5000");

test("latency: release → transcript and reply → first audio", async ({ page, request, browserName }) => {
  test.skip(process.env.E2E_LATENCY !== "1", "set E2E_LATENCY=1 (real upstream required)");
  test.skip(browserName !== "chromium", "fake microphone file is a Chromium flag");
  test.setTimeout(RUNS * (HOLD_MS + 90_000) + 60_000);
  await signIn(page, request);
  await page.goto("/chat");
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("scenario-free").click();
  await expect(page.getByTestId("chat-mic")).toBeEnabled();
  const results: unknown[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
    await recordFor(page, HOLD_MS);
    await expect.poll(async () => page.evaluate(() =>
      ((window as unknown as { __enjoyLatency?: Array<{ spans: { firstAudioAfterReleaseMs?: number } }> }).__enjoyLatency ?? [])
        .filter((r) => r.spans.firstAudioAfterReleaseMs !== undefined).length), { timeout: 120_000 }).toBe(i + 1);
    await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
    await page.getByTestId("conversation-autospeak").click(); // 停掉正在进行的朗读:关
    await page.getByTestId("conversation-autospeak").click(); // 再打开,下一轮照常自动朗读
  }
  const spans = await page.evaluate(() =>
    ((window as unknown as { __enjoyLatency: Array<{ spans: Record<string, number> }> }).__enjoyLatency).map((r) => r.spans));
  results.push(...spans.slice(1)); // 第一轮热身
  console.log(`LATENCY_RESULTS ${JSON.stringify({ holdMs: HOLD_MS, runs: results })}`);
});
