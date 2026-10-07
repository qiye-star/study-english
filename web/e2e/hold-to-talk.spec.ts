import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { mockUpstreams, quiet, TRANSCRIPT, type UpstreamMocks } from "./support/mock-upstreams";
import { touchHold } from "./support/touch";

// 提示条的确切文字(web.chat.hold.*,界面可能是英文或中文):只断言"有提示"的话,没走到预期分支
// (例如麦克风没就绪 → notReady)的丢弃也会通过(review F4 m5)
const CANCELLED = /^(Recording cancelled|已取消录音)$/;
const TOO_SHORT = /^(Hold to talk|按住说话)$/;

// 全部上游(转写/对话/语法/朗读/评测)走路由模拟;守卫保证没有请求漏到真实上游。
test.describe("hold to talk (touch)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP touch events are Chromium-only");

  let mocks: UpstreamMocks;

  test.beforeEach(async ({ page, request }) => {
    mocks = await mockUpstreams(page); // 在登录/导航之前注册,页面的任何请求都经过守卫
    await signIn(page, request);
    await page.goto("/chat");
    await page.getByTestId("conversation-new").click();
    await page.getByTestId("scenario-free").click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    if ((await page.getByTestId("conversation-autospeak").getAttribute("aria-pressed")) === "true") {
      await page.getByTestId("conversation-autospeak").click(); // 本用例不验证朗读
    }
    await expect(page.getByTestId("chat-mic")).toBeEnabled();
  });

  test.afterEach(() => {
    expect(mocks.unmocked, "requests reached an upstream-backed route without a mock").toEqual([]);
  });

  test("hold and release sends", async ({ page }) => {
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 1500 });
    await expect(page.getByText(TRANSCRIPT).first()).toBeVisible();
    await expect(page.getByText("Sure, what size?")).toBeVisible();
    expect(mocks.seen.transcriptions).toBe(1);
  });

  test("slide up to cancel uploads nothing", async ({ page }) => {
    const width = page.viewportSize()!.width;
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 1200, dy: -160, x: width * 0.2 });
    // 先等确定的界面状态(丢弃路径已走完),再等请求安静 1 s,才断言没有上传:会上传的回归不能与断言赛跑
    await expect(page.getByTestId("hold-hint")).toHaveText(CANCELLED);
    await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
    await quiet(mocks);
    expect(mocks.seen.transcriptions).toBe(0);
    expect(mocks.seen.assessments).toBe(0);
  });

  test("slide up to 'to text' fills the composer", async ({ page }) => {
    const width = page.viewportSize()!.width;
    // 2 s:上滑只在麦克风就绪后生效,给慢的麦克风启动留余量(review F4 残余风险 a)
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 2000, dy: -160, x: width * 0.8 });
    await expect(page.getByTestId("chat-input")).toHaveValue(TRANSCRIPT);
    await quiet(mocks);
    expect(mocks.seen.chat).toBe(0);
  });

  test("a short tap shows the hint", async ({ page }) => {
    await touchHold(page, page.getByTestId("chat-mic"), { ms: 100 });
    await expect(page.getByTestId("hold-hint")).toHaveText(TOO_SHORT);
    await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
    await quiet(mocks);
    expect(mocks.seen.transcriptions).toBe(0);
  });
});
