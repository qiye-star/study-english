import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import type { Scalar } from "./api";
import { SettingRow } from "./setting-row";
import { fixtureList } from "./test-fixtures";

const find = (key: string) => fixtureList().items.find((i) => i.key === key)!;
const renderRow = (key: string, draft?: Scalar, onDraft = vi.fn()) =>
  render(
    <MemoryRouter>
      <SettingRow item={find(key)} draft={draft} onDraft={onDraft} readOnly={false} />
    </MemoryRouter>,
  );

it("renders env-only rows without an input", () => {
  renderRow("database_url");
  expect(screen.getByText("只能在 .env 中修改并重启")).toBeInTheDocument();
  expect(screen.getByText("已设置 · 3c90aa21")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByLabelText("新值(留空不修改)")).toBeNull();
});

it("links managed rows to the rank rules page", () => {
  renderRow("rank_daily_rp_cap");
  expect(screen.getByText(/由段位规则管理/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "去段位规则修改" })).toHaveAttribute("href", "/rank/rules");
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

it("clears a secret override through the draft and never shows the value", async () => {
  const onDraft = vi.fn();
  renderRow("upstream_llm_key", undefined, onDraft);
  expect(screen.getByText("env 也已设置(7e5d0c11)")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "清除覆盖" }));
  expect(onDraft).toHaveBeenCalledWith("upstream_llm_key", null);
});

it("marks a dangerous draft and can undo it", async () => {
  const onDraft = vi.fn();
  renderRow("upstream_llm_base_url", "https://other.example/v1", onDraft);
  expect(screen.getByText("改主机会把配对的密钥发送到新地址")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "撤销本次修改" }));
  expect(onDraft).toHaveBeenCalledWith("upstream_llm_base_url", undefined);
});
