import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";

// E2E 栈 ROOMS_AI_GLOBAL_DAILY=0:只测人人互发,不调用房间 AI(零成本;AI 路径由 server/tests/test_rooms_ws.py 覆盖)
test("two members chat in a room by code; the owner removes one", async ({ browser, request }) => {
  // browser.newContext() 继承配置里的 use(baseURL、设备);断言用中文文案
  const alice = await (await browser.newContext({ locale: "zh-CN" })).newPage();
  const bob = await (await browser.newContext({ locale: "zh-CN" })).newPage();
  await signIn(alice, request);
  await signIn(bob, request);

  await alice.goto("/rooms");
  await alice.getByTestId("room-create").click();
  await alice.getByRole("button", { name: "美食" }).click();
  await alice.getByTestId("room-create-submit").click();
  await expect(alice).toHaveURL(/\/rooms\/r\//);
  const codeText = await alice.getByTestId("room-code").innerText();
  const code = /(\d{3}) (\d{3})/.exec(codeText)!.slice(1).join("");

  await bob.goto("/rooms");
  await bob.getByTestId("room-code-input").fill(code);
  await bob.getByTestId("room-join").click();
  await expect(bob).toHaveURL(/\/rooms\/r\//);

  await alice.getByTestId("room-input").fill("Hello from Alice");
  await alice.getByTestId("room-send").click();
  await expect(bob.getByText("Hello from Alice")).toBeVisible();
  await bob.getByTestId("room-input").fill("Hi Alice, I like chocolate.");
  await bob.getByTestId("room-send").click();
  await expect(alice.getByText("Hi Alice, I like chocolate.")).toBeVisible();

  await bob.reload(); // reconnect replays history
  await expect(bob.getByText("Hello from Alice")).toBeVisible();

  await alice.getByRole("button", { name: "成员与设置" }).click();
  await alice.getByRole("button", { name: "移出" }).click();
  await alice.getByTestId("room-confirm").click(); // AlertDialog, not window.confirm (web-rooms ruling)
  await expect(bob.getByText("你已被移出房间")).toBeVisible();
});
