import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FlagsPanel } from "./flags-panel";
import { fixtureList } from "./test-fixtures";

it("shows availability with reasons from the doctor and drafts toggles", async () => {
  const onDraft = vi.fn();
  render(
    <FlagsPanel
      items={fixtureList().items}
      findings={[{ level: "error", code: "realtime_unavailable", keys: ["volcengine_tts_key", "realtime_tts_model"], message: "x" }]}
      onDraft={onDraft}
    />,
  );
  const realtime = screen.getByTestId("flag-realtime_enabled");
  expect(within(realtime).getByText("不可用")).toBeInTheDocument();
  expect(within(realtime).getByText("缺少或无效:VOLCENGINE_TTS_KEY、REALTIME_TTS_MODEL")).toBeInTheDocument();
  expect(within(screen.getByTestId("flag-rooms_enabled")).getByText("可用")).toBeInTheDocument();
  expect(within(screen.getByTestId("flag-rank_enabled")).getByText("已关闭")).toBeInTheDocument();
  await userEvent.click(within(screen.getByTestId("flag-rank_enabled")).getByRole("switch", { name: "段位赛" }));
  expect(onDraft).toHaveBeenCalledWith("rank_enabled", true);
});
