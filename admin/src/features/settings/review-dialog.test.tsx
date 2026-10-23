import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as api from "./api";
import { ReviewDialog } from "./review-dialog";
import { fixtureList, smtpHostItem } from "./test-fixtures";

vi.mock("./api");

it("asks for reason and typed confirmation for dangerous changes and shows the pair warning", async () => {
  vi.mocked(api.saveSettings)
    .mockRejectedValueOnce(
      new ApiError(409, "Key would be sent to a new host", undefined, { pairs: ["upstream_llm_base_url"], hosts: { upstream_llm_base_url: "new.example" } }),
    )
    .mockResolvedValueOnce({ revision: 9, changed: ["upstream_llm_base_url"], pendingRestart: [], applyErrors: [] });
  const onSaved = vi.fn();
  render(<ReviewDialog items={fixtureList().items} draft={{ upstream_llm_base_url: "https://new.example/v1" }} onSaved={onSaved} onClose={() => {}} />);
  expect(screen.getByText(/改主机会把配对的密钥发送到新地址/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("理由"), "迁移上游");
  await userEvent.type(screen.getByLabelText("输入 UPSTREAM_LLM_BASE_URL 以确认"), "UPSTREAM_LLM_BASE_URL");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText("我确认把现有密钥发送到 new.example")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "我确认把现有密钥发送到 new.example" }));
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ confirmPairs: ["upstream_llm_base_url"] }));
  expect(onSaved).toHaveBeenCalled();
});

it("adopts the server's confirmation phrase and shows field errors", async () => {
  vi.mocked(api.saveSettings)
    .mockRejectedValueOnce(new ApiError(409, "Confirmation required", undefined, { confirm: "CONFIRM" }))
    .mockRejectedValueOnce(new ApiError(422, "Invalid settings", { rate_limit_per_minute: "must be between 1 and 10000" }));
  render(<ReviewDialog items={fixtureList().items} draft={{ rate_limit_per_minute: 0 }} onSaved={() => {}} onClose={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  const typing = await screen.findByLabelText("输入 CONFIRM 以确认");
  await userEvent.type(screen.getByLabelText("理由"), "批量调整");
  await userEvent.type(typing, "CONFIRM");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText(/must be between 1 and 10000/)).toBeInTheDocument();
  expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: "CONFIRM", reason: "批量调整" }));
});

it("explains that rank settings are managed by the published rank rules", async () => {
  vi.mocked(api.saveSettings).mockRejectedValueOnce(
    new ApiError(409, "Managed by rank rules", { rank_match_minutes: "Managed by the published rank rules; change it in the rank rules editor (/rank/rules)" }),
  );
  render(<ReviewDialog items={fixtureList().items} draft={{ rate_limit_per_minute: 30 }} onSaved={() => {}} onClose={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText(/已由段位规则管理.*段位规则.*页修改/)).toBeInTheDocument();
  expect(screen.queryByText(/Managed by/)).toBeNull();
});

it("guards an SMTP host change with the SMTP password pair and the typed SMTP_HOST phrase", async () => {
  vi.mocked(api.saveSettings)
    .mockRejectedValueOnce(new ApiError(409, "Key would be sent to a new host", undefined, { pairs: ["smtp_host"], hosts: { smtp_host: "smtp.new.example" } }))
    .mockResolvedValueOnce({ revision: 10, changed: ["smtp_host"], pendingRestart: [], applyErrors: [] });
  const onSaved = vi.fn();
  render(<ReviewDialog items={[...fixtureList().items, smtpHostItem()]} draft={{ smtp_host: "smtp.new.example" }} onSaved={onSaved} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText("理由"), "迁移邮件服务");
  await userEvent.type(screen.getByLabelText("输入 SMTP_HOST 以确认"), "SMTP_HOST");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  await userEvent.click(await screen.findByRole("checkbox", { name: "我确认把现有密钥发送到 smtp.new.example" }));
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ confirmPairs: ["smtp_host"] }));
  expect(onSaved).toHaveBeenCalled();
});
