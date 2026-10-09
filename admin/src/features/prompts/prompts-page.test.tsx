import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import * as api from "./api";
import { PromptsPage } from "./prompts-page";

vi.mock("./api");

it("shows one card per prompt and links rank prompts to the rank rules page", async () => {
  vi.mocked(api.listPrompts).mockResolvedValue([
    { key: "grammar.rules", label: "语法检查规则", kind: "text", publishedVersion: 3, publishedAt: "2026-10-09T08:00:00Z", hasDraft: true },
    { key: "config.chat_agent_templates", label: "对话情景模板", kind: "json", publishedVersion: null, publishedAt: null, hasDraft: false },
  ]);
  render(<MemoryRouter><PromptsPage /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: /语法检查规则/ })).toHaveAttribute("href", "/prompts/grammar.rules");
  expect(screen.getByText("已发布 v3")).toBeInTheDocument();
  expect(screen.getByText("有草稿")).toBeInTheDocument();
  expect(screen.getByText("使用默认")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "在段位规则中管理" })).toHaveAttribute("href", "/rank/rules");
});
