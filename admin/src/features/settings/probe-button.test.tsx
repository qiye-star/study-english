import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { PROBE_FOR, ProbeButton } from "./probe-button";

vi.mock("./api");
beforeEach(() => vi.clearAllMocks());

it("maps the SMTP host setting to the smtp probe", () => {
  expect(PROBE_FOR.smtp_host).toBe("smtp");
});

it("shows the SMTP auth result with the reply code and time, never a host or secret", async () => {
  vi.mocked(api.runProbe).mockResolvedValueOnce({ ok: false, status: 535, ms: 42, code: "auth" });
  render(<ProbeButton upstream="smtp" values={{}} />);
  await userEvent.click(screen.getByRole("button", { name: "测试连接" }));
  expect(api.runProbe).toHaveBeenCalledWith("smtp", expect.objectContaining({ values: {} }));
  expect(await screen.findByText("鉴权失败(检查密钥)")).toBeInTheDocument();
  expect(screen.getByText("535 · 42 ms")).toBeInTheDocument();
});

it("explains a blocked private SMTP host and a missing configuration", async () => {
  vi.mocked(api.runProbe).mockResolvedValueOnce({ ok: false, status: 0, ms: 0, code: "blocked_private" });
  const { unmount } = render(<ProbeButton upstream="smtp" values={{}} />);
  await userEvent.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText(/内网地址不允许探测/)).toBeInTheDocument();
  unmount();
  vi.mocked(api.runProbe).mockResolvedValueOnce({ ok: false, status: 0, ms: 0, code: "not_configured" });
  render(<ProbeButton upstream="smtp" values={{}} />);
  await userEvent.click(screen.getAllByRole("button", { name: "测试连接" }).at(-1)!);
  expect(await screen.findByText("未配置")).toBeInTheDocument();
});
