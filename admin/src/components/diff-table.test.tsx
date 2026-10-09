import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DiffTable } from "./diff-table";

it("shows old to new and masks secrets as fingerprints", () => {
  render(
    <DiffTable
      rows={[
        { key: "rate_limit_per_minute", label: "登录每分钟", before: 10, after: 20, apply: "hot" },
        { key: "upstream_llm_key", label: "LLM 密钥", before: { set: true, fp: "a1b2c3d4" }, after: { set: true, fp: "9f8e7d6c" } },
      ]}
    />,
  );
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText("20")).toBeInTheDocument();
  expect(screen.getByText("已设置 · a1b2c3d4")).toBeInTheDocument();
  expect(screen.getByText("已设置 · 9f8e7d6c")).toBeInTheDocument();
});
